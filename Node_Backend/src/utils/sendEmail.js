const nodemailer = require('nodemailer');

const sendEmail = async (toEmail, otp) => {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });

  const mailOptions = {
    from: `"Smart City Support" <${process.env.EMAIL_USER}>`,
    to: toEmail,
    subject: 'Your Smart City Verification Code',
    html: `
      <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9; border-radius: 10px; border: 1px solid #e0e0e0;">
        <div style="text-align: center; margin-bottom: 20px;">
          <h1 style="color: #4CAF50; margin: 0; font-size: 24px;">Smart City Verification</h1>
        </div>
        <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
          <p style="color: #555555; font-size: 16px; margin-top: 0;">Hello,</p>
          <p style="color: #555555; font-size: 16px; line-height: 1.5;">Thank you for using Smart City! To proceed, please use the verification code below:</p>
          <div style="text-align: center; margin: 30px 0;">
            <span style="display: inline-block; padding: 15px 30px; background-color: #f0f7f4; border: 2px dashed #4CAF50; border-radius: 8px; font-size: 32px; font-weight: bold; color: #4CAF50; letter-spacing: 5px;">${otp}</span>
          </div>
          <p style="color: #777777; font-size: 14px; text-align: center; margin-bottom: 0;">This code will expire in 5 minutes. If you did not request this code, you can safely ignore this email.</p>
        </div>
        <div style="text-align: center; margin-top: 20px; color: #999999; font-size: 12px;">
          <p>Best Regards,<br/><strong>Smart City Team</strong></p>
          <p>&copy; ${new Date().getFullYear()} Smart City. All rights reserved.</p>
        </div>
      </div>
    `
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('Email sent: ' + info.response);
    return info;
  } catch (error) {
    console.error('Nodemailer error:', error);
    throw error;
  }
};

module.exports = sendEmail;