import { env } from "@/lib/config/env";

/**
 * Transactional email bodies.
 *
 * Every template returns both `html` and `text`: a plain-text alternative is
 * what makes the message readable in a screen reader and stops it scoring as
 * spam. Layout is table-based inline CSS because email clients have no
 * meaningful support for anything else.
 */

interface Template {
  subject: string;
  html: string;
  text: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function layout(heading: string, body: string, cta?: { label: string; url: string }): string {
  return `<!doctype html>
<html lang="en">
<body style="margin:0;padding:24px;background:#f4f7f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#12211f;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;border:1px solid #dfe9e8;">
    <tr><td style="padding:28px 32px 8px;">
      <p style="margin:0;font-size:18px;font-weight:600;color:#0d6b5f;">${escapeHtml(env.APP_NAME)}</p>
    </td></tr>
    <tr><td style="padding:8px 32px 0;">
      <h1 style="margin:0 0 12px;font-size:20px;line-height:1.35;">${escapeHtml(heading)}</h1>
      ${body}
    </td></tr>
    ${
      cta
        ? `<tr><td style="padding:20px 32px 8px;">
             <a href="${cta.url}" style="display:inline-block;background:#0d6b5f;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;">${escapeHtml(cta.label)}</a>
           </td></tr>
           <tr><td style="padding:4px 32px 24px;">
             <p style="margin:0;font-size:12px;color:#5b6b69;">If the button does not work, paste this link into your browser:<br><span style="word-break:break-all;">${cta.url}</span></p>
           </td></tr>`
        : `<tr><td style="height:24px;"></td></tr>`
    }
    <tr><td style="padding:16px 32px 24px;border-top:1px solid #eef4f3;">
      <p style="margin:0;font-size:12px;color:#5b6b69;">${escapeHtml(env.APP_NAME)} does not provide emergency care. In an emergency, call your local emergency number.</p>
    </td></tr>
  </table>
</body>
</html>`;
}

export function verificationEmail(input: { name: string; url: string }): Template {
  const heading = "Confirm your email address";
  return {
    subject: `Confirm your email — ${env.APP_NAME}`,
    html: layout(
      heading,
      `<p style="margin:0;font-size:15px;line-height:1.6;">Hello ${escapeHtml(input.name)}, please confirm this address so we can send you appointment confirmations and reminders. The link expires in 24 hours.</p>`,
      { label: "Confirm email", url: input.url },
    ),
    text: `Hello ${input.name},\n\nConfirm your email address to finish setting up your ${env.APP_NAME} account:\n${input.url}\n\nThis link expires in 24 hours. If you did not create an account, ignore this message.`,
  };
}

export function passwordResetEmail(input: { name: string; url: string }): Template {
  const heading = "Reset your password";
  return {
    subject: `Reset your password — ${env.APP_NAME}`,
    html: layout(
      heading,
      `<p style="margin:0;font-size:15px;line-height:1.6;">Hello ${escapeHtml(input.name)}, we received a request to reset your password. If it was not you, no action is needed — your current password still works.</p>`,
      { label: "Choose a new password", url: input.url },
    ),
    text: `Hello ${input.name},\n\nReset your ${env.APP_NAME} password:\n${input.url}\n\nIf you did not request this, ignore this message — your current password still works.`,
  };
}

export function welcomeEmail(input: { name: string; appUrl: string }): Template {
  return {
    subject: `Welcome to ${env.APP_NAME}`,
    html: layout(
      "Your account is ready",
      `<p style="margin:0;font-size:15px;line-height:1.6;">Welcome, ${escapeHtml(input.name)}. You can now search verified doctors, compare real availability, and book in-person or video consultations.</p>`,
      { label: "Find a doctor", url: `${input.appUrl}/doctors` },
    ),
    text: `Welcome, ${input.name}.\n\nYour ${env.APP_NAME} account is ready. Find a doctor: ${input.appUrl}/doctors`,
  };
}

export function appointmentConfirmationEmail(input: {
  name: string;
  doctorName: string;
  when: string;
  mode: string;
  reference: string;
  url: string;
}): Template {
  return {
    subject: `Appointment confirmed — ${input.doctorName}, ${input.when}`,
    html: layout(
      "Your appointment is confirmed",
      `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;">Hello ${escapeHtml(input.name)}, your appointment is booked.</p>
       <table role="presentation" cellpadding="0" cellspacing="0" style="font-size:14px;line-height:1.8;">
         <tr><td style="color:#5b6b69;padding-right:16px;">Doctor</td><td style="font-weight:600;">${escapeHtml(input.doctorName)}</td></tr>
         <tr><td style="color:#5b6b69;padding-right:16px;">When</td><td style="font-weight:600;">${escapeHtml(input.when)}</td></tr>
         <tr><td style="color:#5b6b69;padding-right:16px;">Type</td><td style="font-weight:600;">${escapeHtml(input.mode)}</td></tr>
         <tr><td style="color:#5b6b69;padding-right:16px;">Reference</td><td style="font-weight:600;">${escapeHtml(input.reference)}</td></tr>
       </table>`,
      { label: "View appointment", url: input.url },
    ),
    text: `Hello ${input.name},\n\nYour appointment is confirmed.\n\nDoctor: ${input.doctorName}\nWhen: ${input.when}\nType: ${input.mode}\nReference: ${input.reference}\n\nView it here: ${input.url}`,
  };
}
