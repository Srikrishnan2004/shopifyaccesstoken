// server/index.js
import express from 'express';
import cookieParser from 'cookie-parser';
import crypto from 'crypto';
import axios from 'axios';
import dotenv from 'dotenv';
import cors from 'cors';

dotenv.config();

const { SHOPIFY_API_KEY, SHOPIFY_API_SECRET, SHOPIFY_SCOPES, HOST } = process.env;
const app = express();
app.use(cors());
app.use(cookieParser());

/** 1️⃣ /auth — redirect merchant to Shopify */
app.get('/auth', (req, res) => {
    console.log("Entering into the auth route.");

    const { shop, email } = req.query;
    if (!shop) return res.status(400).send('Missing shop parameter');

    // generate a nonce for CSRF protection
    const state = crypto.randomBytes(16).toString('hex');
    res.cookie('state', state, { httpOnly: true, secure: true, sameSite: 'lax' });

    // First, redirect to the login page to ensure the user is logged in
    const loginUrl = `https://${shop}/admin`;

    // Then, redirect to the OAuth authorization URL
    const redirectUri = `${HOST}/auth/callback`;
    const installUrl = `https://${shop}/admin/oauth/authorize` +
        `?client_id=${SHOPIFY_API_KEY}` +
        `&scope=${SHOPIFY_SCOPES}` +
        `&state=${state}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}`;

    // Store email in a cookie instead of trying to pass it in the redirect URI
    if (email) {
        res.cookie('shopify_email', email, { httpOnly: true, secure: true, sameSite: 'lax' });
    }
    // Create an HTML page that first redirects to login, then to the OAuth page
    const redirectHtml = `
    <!DOCTYPE html>
<html>
<head>
    <title>Redirecting to Shopify</title>
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
            color: #ffffff;
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

        /* Complex Loader Styles */
        .loader-container {
            position: relative;
            width: 120px;
            height: 120px;
            margin: 30px auto;
        }

        .loader {
            position: absolute;
            width: 100%;
            height: 100%;
            border-radius: 50%;
            border: 3px solid transparent;
            border-top-color: #ff6b35;
            animation: spin 2s linear infinite;
            box-shadow: 0 0 20px rgba(255, 107, 53, 0.2);
        }

        .loader::before,
        .loader::after {
            content: '';
            position: absolute;
            border-radius: 50%;
            border: 3px solid transparent;
            border-top-color: #ff6b35;
            box-shadow: 0 0 20px rgba(255, 107, 53, 0.2);
        }

        .loader::before {
            top: 5px;
            left: 5px;
            right: 5px;
            bottom: 5px;
            animation: spin 3s linear infinite reverse;
        }

        .loader::after {
            top: 15px;
            left: 15px;
            right: 15px;
            bottom: 15px;
            animation: spin 1.5s linear infinite;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
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
            
            .loader-container {
                width: 100px;
                height: 100px;
            }
        }
    </style>
</head>
<body>
    <div class="glow"></div>
    <div class="container">
        <h1>Connecting to Shopify</h1>
        <p>Please wait while we connect to your Shopify store...</p>
        <div class="loader-container">
            <div class="loader"></div>
        </div>
        <p>You'll be redirected to Shopify to authorize this application.</p>
    </div>
    <script>
        // First ensure the user is logged in by redirecting to admin
        setTimeout(() => {
            // Open admin in a new tab/window to ensure login
            const loginWindow = window.open('${loginUrl}', '_blank');
            
            // After a short delay, redirect to the OAuth page
            setTimeout(() => {
                window.location.href = '${installUrl}';
                // Try to close the login window if possible
                if (loginWindow) {
                    try {
                        loginWindow.close();
                    } catch (e) {
                        console.log('Could not close login window');
                    }
                }
            }, 3000);
        }, 1000);
    </script>
</body>
</html>
    `;

    return res.send(redirectHtml);
});

/** 2️⃣ /auth/callback — Shopify comes back here with code & hmac */
app.get('/auth/callback', async (req, res) => {
    console.log("Entering into the auth/callback route.");

    const { shop, hmac, code, state } = req.query;
    const email = req.cookies.shopify_email;
    console.log("Email from cookie:", email);

    const stateCookie = req.cookies.state;
    if (state !== stateCookie) return res.status(403).send('Invalid state');

    // validate the request is from Shopify
    const map = { ...req.query };
    delete map.hmac; delete map.signature;
    const message = Object.keys(map).sort()
        .map((key) => `${key}=${map[key]}`)
        .join('&');
    const generatedHash = crypto
        .createHmac('sha256', SHOPIFY_API_SECRET)
        .update(message)
        .digest('hex');
    if (generatedHash !== hmac) return res.status(400).send('HMAC mismatch');

    // exchange temporary code for a permanent access token
    try {
        const tokenResponse = await axios.post(`https://${shop}/admin/oauth/access_token`, {
            client_id: SHOPIFY_API_KEY,
            client_secret: SHOPIFY_API_SECRET,
            code
        });
        const accessToken = tokenResponse.data.access_token;

        // Create form data and call the API to save the access token
        let apiResponse = {};
        try {
            const formData = new FormData();
            formData.append('shopifyAccessToken', accessToken);
            if (email) {
                formData.append('email', email);
            }

            const saveTokenResponse = await axios.post(
                'https://save-shopify-acces-token-201137466588.asia-south1.run.app',
                formData,
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    }
                }
            );

            apiResponse = saveTokenResponse.data;
            console.log('API Response:', apiResponse);
        } catch (apiError) {
            console.error('API call error:', apiError);
            apiResponse = { error: 'Failed to save access token' };
        }

        // Display success HTML page with API response
        const successHtml = `
        <!DOCTYPE html>
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
            color: #ff6b35;
            font-size: 40px;
            font-weight: bold;
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
            word-break: break-all;
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
        <a href="http://localhost:5173?shop=${encodeURIComponent(shop)}&accessToken=${encodeURIComponent(accessToken)}${email ? `&email=${encodeURIComponent(email)}` : ''}" class="button">Continue to App</a>
    </div>
    <script>
        // Automatically redirect after 5 seconds
        setTimeout(() => {
            window.location.href = "http://localhost:5173?shop=${encodeURIComponent(shop)}&accessToken=${encodeURIComponent(accessToken)}${email ? `&email=${encodeURIComponent(email)}` : ''}";
        }, 5000);
    </script>
</body>
</html>
        `;

        return res.send(successHtml);
    } catch (err) {
        console.error(err);
        return res.status(500).send('Failed to get access token');
    }
});

app.listen(process.env.PORT || 3000, () => {
    console.log('🚀 Server listening');
});
