// const nodemailer = require("nodemailer");

// const sendEmail = async (to, otp) => {
//   const transporter = nodemailer.createTransport({
//     host: "142.250.191.109", // IPv4 for smtp.gmail.com
//     port: 587,
//     secure: false, // true for 465, false for other ports
//     auth: {
//       user: process.env.EMAIL_USER,
//       pass: process.env.EMAIL_PASS,
//     },
//     tls: {
//       rejectUnauthorized: false
//     }
//   });

//   const mailOptions = {
//     from: `"Smart City Support" <${process.env.EMAIL_USER}>`,
//     to: to,
//     subject: "Your Smart City OTP Code",
//     html: `
//       <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #ddd;">
//         <h2 style="color: #333;">Smart City Verification</h2>
//         <p>Hello,</p>
//         <p>Your OTP code is: <strong style="font-size: 24px; color: #007bff;">${otp}</strong></p>
//         <p>This code will expire in 5 minutes.</p>
//         <br />
//         <p>Best Regards,<br/>Smart City Team</p>
//       </div>
//     `,
//   };

//   await transporter.sendMail(mailOptions);
// };

// module.exports = sendEmail;

const { Resend } = require("resend");
const resend = new Resend(process.env.RESEND_API_KEY);

const sendEmail = async (to, otp) => {
  await resend.emails.send({
    from: "Smart City Support <aungsiphyoit@gmail.com>", // Resend မှာ domain verify လုပ်ရမယ် (or သူတို့ default sandbox domain သုံးလို့ရ)
    to,
    subject: "Your Smart City OTP Code",
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #ddd;">
        <h2 style="color: #333;">Smart City Verification</h2>
        <p>Hello,</p>
        <p>Your OTP code is: <strong style="font-size: 24px; color: #007bff;">${otp}</strong></p>
        <p>This code will expire in 5 minutes.</p>
        <br />
        <p>Best Regards,<br/>Smart City Team</p>
      </div>
    `,
  });
};

module.exports = sendEmail;