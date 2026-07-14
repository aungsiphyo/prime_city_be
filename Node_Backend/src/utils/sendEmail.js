const fetch = require('node-fetch');

const sendEmail = async (toEmail, otp) => {
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': process.env.BREVO_API_KEY
    },
    body: JSON.stringify({
      sender: { name: 'Smart City Support', email: 'phyomyatmin646@gmail.com' },
      to: [{ email: toEmail }],
      subject: 'Your Smart City OTP Code',
      htmlContent: `
        <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #ddd;">
          <h2 style="color: #333;">Smart City Verification</h2>
          <p>Hello,</p>
          <p>Your OTP code is: <strong style="font-size: 24px; color: #007bff;">${otp}</strong></p>
          <p>This code will expire in 5 minutes.</p>
          <br />
          <p>Best Regards,<br/>Smart City Team</p>
        </div>
      `
    })
  });

  if (!response.ok) {
    const err = await response.text();
    console.error('Brevo error:', err);
    throw new Error(err);
  }

  return response.json();
};

module.exports = sendEmail;