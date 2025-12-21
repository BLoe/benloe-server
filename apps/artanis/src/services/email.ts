import Mailgun from 'mailgun.js';
import formData from 'form-data';

const mailgun = new Mailgun(formData);
const mg = mailgun.client({
  username: 'api',
  key: process.env.MAILGUN_API_KEY || '',
  url: process.env.MAILGUN_BASE_URL || 'https://api.mailgun.net',
});

export async function sendMagicLink(
  email: string,
  token: string,
  redirectUrl?: string
): Promise<boolean> {
  const baseUrl = process.env.FRONTEND_URL || 'https://auth.benloe.com';
  const verifyUrl = `${baseUrl}/verify?token=${token}${redirectUrl ? `&redirect=${encodeURIComponent(redirectUrl)}` : ''}`;

  const mailOptions = {
    from: process.env.FROM_EMAIL || 'noreply@mail.benloe.com',
    to: email,
    subject: 'Your login link for benloe.com',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
          <meta charset="utf-8">
          <style>
              body { 
                  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
                  line-height: 1.6; 
                  color: #333; 
                  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                  margin: 0;
                  padding: 20px;
              }
              .container { 
                  max-width: 600px; 
                  margin: 0 auto; 
                  background: white;
                  border-radius: 12px;
                  box-shadow: 0 10px 25px rgba(0,0,0,0.1);
                  overflow: hidden;
              }
              .header { 
                  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                  color: white;
                  text-align: center; 
                  padding: 40px 20px;
              }
              .content {
                  padding: 40px 30px;
              }
              .button { 
                  display: inline-block; 
                  padding: 16px 32px; 
                  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                  color: white; 
                  text-decoration: none; 
                  border-radius: 8px; 
                  font-weight: 600;
                  box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3);
                  transition: transform 0.2s ease;
              }
              .button:hover {
                  transform: translateY(-2px);
              }
              .footer { 
                  margin-top: 30px; 
                  padding-top: 20px; 
                  border-top: 1px solid #eee; 
                  font-size: 14px; 
                  color: #666; 
              }
              .link-box {
                  word-break: break-all; 
                  background-color: #f8fafc; 
                  padding: 16px; 
                  border-radius: 8px; 
                  border: 1px solid #e2e8f0;
                  font-family: 'SF Mono', Monaco, monospace;
                  font-size: 13px;
              }
          </style>
      </head>
      <body>
          <div class="container">
              <div class="header">
                  <h1 style="margin: 0; font-size: 28px;">🔐 Login to benloe.com</h1>
              </div>
              
              <div class="content">
                  <p style="font-size: 16px; margin-bottom: 20px;">Hi there,</p>
                  
                  <p style="font-size: 16px; margin-bottom: 30px;">Click the button below to securely log in to your benloe.com account:</p>
                  
                  <div style="text-align: center; margin: 40px 0;">
                      <a href="${verifyUrl}" class="button">Log in to benloe.com</a>
                  </div>
                  
                  <p style="font-size: 14px; color: #666; margin-bottom: 10px;">Or copy and paste this link into your browser:</p>
                  <div class="link-box">${verifyUrl}</div>
                  
                  <div class="footer">
                      <p><strong>⏰ This link will expire in 15 minutes</strong> for security.</p>
                      <p>If you didn't request this login, you can safely ignore this email.</p>
                      <p style="margin-top: 20px; color: #999;">Sent from benloe.com authentication system</p>
                  </div>
              </div>
          </div>
      </body>
      </html>
    `,
    text: `
      🔐 Login to benloe.com
      
      Hi there,
      
      Click this link to securely log in to your benloe.com account:
      ${verifyUrl}
      
      ⏰ This link will expire in 15 minutes for security.
      If you didn't request this login, you can safely ignore this email.
      
      Sent from benloe.com authentication system
    `,
  };

  try {
    console.log(
      `Attempting to send magic link to ${email} using domain: ${process.env.MAILGUN_DOMAIN}`
    );

    const result = await mg.messages.create(
      process.env.MAILGUN_DOMAIN || 'mail.benloe.com',
      mailOptions
    );

    console.log(`Magic link sent successfully to ${email}`, result);
    return true;
  } catch (error) {
    console.error('Error sending magic link:', error);
    throw new Error('Failed to send magic link');
  }
}
