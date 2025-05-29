import express from 'express';
import cookieParser from 'cookie-parser';
import crypto from 'crypto';
import axios from 'axios';
import dotenv from 'dotenv';
import cors from 'cors';
import FormData from 'form-data';
import { WebSocketServer } from 'ws';

dotenv.config();

const { SHOPIFY_API_KEY, SHOPIFY_API_SECRET, SHOPIFY_SCOPES, HOST } = process.env;
const app = express();
app.use(cors());
app.use(cookieParser());

const clients = new Map();

const wss = new WebSocketServer({ noServer: true });
wss.on('connection', (ws, request) => {
    const params = new URLSearchParams(request.url.substring(1));
    const shop = params.get('shop');
    if (shop) {
        console.log(`WebSocket connected for shop: ${shop}`);
        clients.set(shop, ws);
        ws.on('close', () => {
            console.log(`WebSocket closed for shop: ${shop}`);
            clients.delete(shop);
        });
    }
});

/** /auth – connect and send connectingHtml with WebSocket & CSS */
app.get('/auth', (req, res) => {
    console.log('auth called');
    const { shop, email } = req.query;
    if (!shop) return res.status(400).send('Missing shop parameter');

    const state = crypto.randomBytes(16).toString('hex');
    res.cookie('state', state, { httpOnly: true, secure: true, sameSite: 'lax' });

    const redirectUri = `${HOST}/auth/callback`;
    const installUrl = `https://${shop}/admin/oauth/authorize` +
        `?client_id=${SHOPIFY_API_KEY}` +
        `&scope=${SHOPIFY_SCOPES}` +
        `&state=${state}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}`;

    if (email) {
        res.cookie('shopify_email', email, { httpOnly: true, secure: true, sameSite: 'lax' });
    }

    const connectingHtml = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Connecting to Shopify</title>
        <style>
            * { 
                margin: 0; 
                padding: 0; 
                box-sizing: 
                border-box; 
            }
            body {
                font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
                text-align: center;
                background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
                overflow: hidden;
                color: #ffffff;
            }
            .container {
                background: rgba(255, 255, 255, 0.05);
                backdrop-filter: blur(10px);
                -webkit-backdrop-filter: blur(10px);
                border-radius: 20px;
                padding: 40px;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
                width: 90%; max-width: 600px;
                margin: 0 auto;
                border: 1px solid rgba(255, 255, 255, 0.1);
            }
            h1 { 
                color: #ff6b35; 
                font-size: 2.5em; 
                margin-bottom: 20px; 
                font-weight: 600; 
            }
            p { 
                color: #e0e0e0; 
                font-size: 1.1em; 
                line-height: 1.6; 
                margin: 15px 0; 
            }
            .loader-container { 
                margin: 30px auto; 
                width: 80px; 
                height: 80px; 
                position: relative; 
            }
            .loader {
                width: 100%; 
                height: 100%; 
                border-radius: 50%; 
                border: 3px solid transparent;
                border-top-color: #ff6b35; 
                animation: spin 1s linear infinite; 
                position: relative;
            }
            .loader::before, .loader::after {
                content: ''; 
                position: absolute; 
                border-radius: 50%; 
                border: 3px solid transparent;
            }
            .loader::before {
                top: 5px; 
                left: 5px; 
                right: 5px; 
                bottom: 5px; 
                border-top-color: #ff8c53;
                animation: spin 3s linear infinite reverse;
            }
            .loader::after {
                top: 15px; 
                left: 15px; 
                right: 15px; 
                bottom: 15px; 
                border-top-color: #ffbf90;
                animation: spin 1.5s linear infinite;
            }
            @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
            .glow {
                position: absolute; 
                width: 300px; 
                height: 300px;
                background: radial-gradient(circle, rgba(255, 107, 53, 0.2) 0%, rgba(255, 107, 53, 0) 70%);
                border-radius: 50%; 
                filter: blur(20px); 
                z-index: -1; 
                animation: pulse 3s ease-in-out infinite;
            }
            @keyframes pulse { 
                0% { 
                    transform: scale(1); 
                    opacity: 0.5; 
                } 50% { 
                    transform: scale(1.2);
                    opacity: 0.8; 
                } 100% {
                    transform: scale(1); 
                    opacity: 0.5; 
                } 
            }
        </style>
    </head>
    <body>
        <div class="glow"></div>
        <div class="container">
            <h1 id="status">Connecting to Shopify Store...</h1>
            <p id="detail">Please wait while we connect to your Shopify store...</p>
            <div class="loader-container"><div class="loader"></div></div>
            <p>You'll be redirected to Shopify to authorize this application.</p>
        </div>
        <script>
            const shop = "${shop}";
            const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
            const ws = new WebSocket(wsProtocol + "//" + window.location.host + "/?shop=" + encodeURIComponent(shop));
            ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                if (data.status === 'connected') {
                    document.getElementById('status').textContent = "Connected to Shopify Store!";
                    document.getElementById('detail').textContent = "Your store has been successfully connected.";
                    document.querySelector(".loader-container").innerHTML = "✅";
                }
            };
            ws.onclose = () => console.log("WebSocket closed");
            // Redirect to the install URL after a short delay
            setTimeout(() => {
                window.open('${installUrl}', '_blank', 'noopener,noreferrer');
            }, 2000);        
        </script>
    </body>
    </html>
    `;
    return res.send(connectingHtml);
});

/** /auth/callback – notify WebSocket client */
app.get('/auth/callback', async (req, res) => {
    console.log('auth/callback called');
    const { shop, hmac, code, state } = req.query;
    const email = req.cookies.shopify_email;
    const stateCookie = req.cookies.state;
    if (state !== stateCookie) return res.status(403).send('Invalid state');

    const map = { ...req.query };
    delete map.hmac; delete map.signature;
    const message = Object.keys(map).sort().map(key => `${key}=${map[key]}`).join('&');
    const generatedHash = crypto.createHmac('sha256', SHOPIFY_API_SECRET).update(message).digest('hex');
    if (generatedHash !== hmac) return res.status(400).send('HMAC mismatch');

    try {
        const tokenResponse = await axios.post(`https://${shop}/admin/oauth/access_token`, {
            client_id: SHOPIFY_API_KEY, client_secret: SHOPIFY_API_SECRET, code
        });
        const accessToken = tokenResponse.data.access_token;

        const client = clients.get(shop);
        if (client && client.readyState === 1) {
            client.send(JSON.stringify({ status: 'connected', shop }));
        }

        res.clearCookie('state'); res.clearCookie('shopify_email');

        const formData = new FormData();
        formData.append('shopifyAccessToken', accessToken);
        if (email) formData.append('email', email);
        formData.append('shop', shop);

        let apiResponse = {};
        try {
            const saveTokenResponse = await axios.post(
                'https://save-shopify-acces-token-201137466588.asia-south1.run.app',
                formData, { headers: formData.getHeaders() }
            );
            apiResponse = saveTokenResponse.data;
        } catch (apiError) {
            console.error('API call error:', apiError);
            apiResponse = { error: 'Failed to save access token' };
        }

        const dashboardUrl = `https://dashboard.strategyfox.in?shop=${encodeURIComponent(shop)}&accessToken=${encodeURIComponent(accessToken)}${email ? `&email=${encodeURIComponent(email)}` : ''}`;

        return res.send(`<!DOCTYPE html>
        <html>
        <head>
            <title>Authentication Successful</title>
            <style>
                * {
                    margin: 0;
                    padding: 0;
                    box-sizing: border-box;
                }
        
                body {
                    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
                    text-align: center;
                    background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
                    min-height: 100vh;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    overflow: hidden;
                    color: #ffffff;
                }
        
                .container {
                    background: rgba(255, 255, 255, 0.05);
                    backdrop-filter: blur(10px);
                    -webkit-backdrop-filter: blur(10px);
                    border-radius: 20px;
                    padding: 40px;
                    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
                    width: 90%;
                    max-width: 600px;
                    margin: 0 auto;
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    position: relative;
                }
        
                h1 {
                    color: #ff6b35;
                    font-size: 2.5em;
                    margin-bottom: 20px;
                    font-weight: 600;
                }
        
                p {
                    color: #e0e0e0;
                    font-size: 1.1em;
                    line-height: 1.6;
                    margin: 15px 0;
                }
        
                .success-icon {
                    width: 80px;
                    height: 80px;
                    background: rgba(255, 107, 53, 0.1);
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    margin: 0 auto 30px;
                    position: relative;
                    animation: successPulse 2s ease-in-out infinite;
                }
        
                .success-icon::before {
                    content: '✓';
                    font-size: 40px;
                    color: #ff6b35;
                    animation: checkmark 0.8s ease-in-out forwards;
                }
        
                @keyframes checkmark {
                    0% {
                        transform: scale(0);
                        opacity: 0;
                    }
                    50% {
                        transform: scale(1.2);
                    }
                    100% {
                        transform: scale(1);
                        opacity: 1;
                    }
                }
        
                @keyframes successPulse {
                    0% {
                        box-shadow: 0 0 0 0 rgba(255, 107, 53, 0.4);
                    }
                    70% {
                        box-shadow: 0 0 0 20px rgba(255, 107, 53, 0);
                    }
                    100% {
                        box-shadow: 0 0 0 0 rgba(255, 107, 53, 0);
                    }
                }
        
                .success-icon::after {
                    content: '';
                    position: absolute;
                    width: 100%;
                    height: 100%;
                    border-radius: 50%;
                    border: 2px solid #ff6b35;
                    animation: successRing 2s ease-in-out infinite;
                }
        
                .token-info {
                    background: rgba(255, 255, 255, 0.05);
                    padding: 20px;
                    border-radius: 10px;
                    margin: 20px 0;
                    text-align: left;
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    position: relative;
                    overflow: hidden;
                }
        
                .token-info::before {
                    content: '';
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: linear-gradient(45deg, transparent, rgba(255, 107, 53, 0.1), transparent);
                    animation: shimmer 2s infinite;
                }
        
                .button {
                    background: linear-gradient(45deg, #ff6b35, #ff8c53);
                    color: white;
                    border: none;
                    padding: 15px 30px;
                    border-radius: 10px;
                    cursor: pointer;
                    text-decoration: none;
                    display: inline-block;
                    margin-top: 20px;
                    font-weight: 600;
                    font-size: 1.1em;
                    transition: transform 0.3s ease, box-shadow 0.3s ease;
                    box-shadow: 0 4px 15px rgba(255, 107, 53, 0.3);
                }
        
                .button:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 6px 20px rgba(255, 107, 53, 0.4);
                }
        
                .glow {
                    position: absolute;
                    width: 300px;
                    height: 300px;
                    background: radial-gradient(circle, rgba(255, 107, 53, 0.2) 0%, rgba(255, 107, 53, 0) 70%);
                    border-radius: 50%;
                    filter: blur(20px);
                    z-index: -1;
                    animation: pulse 3s ease-in-out infinite;
                }
        
                @keyframes successPulse {
                    0%, 100% { transform: scale(1); }
                    50% { transform: scale(1.05); }
                }
        
                @keyframes successRing {
                    0% { transform: scale(1); opacity: 1; }
                    50% { transform: scale(1.2); opacity: 0.5; }
                    100% { transform: scale(1); opacity: 1; }
                }
        
                @keyframes shimmer {
                    0% { transform: translateX(-100%); }
                    100% { transform: translateX(100%); }
                }
        
                @keyframes pulse {
                    0% { transform: scale(1); opacity: 0.5; }
                    50% { transform: scale(1.2); opacity: 0.8; }
                    100% { transform: scale(1); opacity: 0.5; }
                }
        
                /* Responsive adjustments */
                @media (max-width: 480px) {
                    .container {
                        padding: 30px 20px;
                    }
                    
                    h1 {
                        font-size: 2em;
                    }
                    
                    .success-icon {
                        width: 60px;
                        height: 60px;
                    }
        
                    .success-icon::before {
                        font-size: 30px;
                    }
        
                    .button {
                        padding: 12px 24px;
                        font-size: 1em;
                    }
                }
            </style>
        </head>
        <body>
            <div class="glow"></div>
            <div class="container">
                <div class="success-icon"></div>
                <h1>Authentication Successful!</h1>
                <p>Your Shopify store <strong>${shop}</strong> has been successfully connected.</p>
                <p>The access token has been saved successfully.</p>
                <div class="token-info">
                    <p><strong>API Response:</strong></p>
                    <pre style="max-height: 200px; overflow: auto; margin-top: 10px; color: #e0e0e0; font-size: 0.9em;">${JSON.stringify(apiResponse, null, 2)}</pre>
                </div>
                <a href="${dashboardUrl}" target="_blank" rel="noopener noreferrer" class="button">Continue to Dashboard</a>
            </div>
        </body>
        </html>`);
    } catch (err) {
        console.error('OAuth error:', err.message);
        return res.status(500).send('Failed to get access token: ' + err.message);
    }
});

const server = app.listen(process.env.PORT || 3000, () => console.log('🚀 Server listening'));
server.on('upgrade', (req, socket, head) => wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req)));
