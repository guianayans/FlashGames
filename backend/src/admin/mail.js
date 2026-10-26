import { adminConfig as config } from "./config.js";

// nodemailer é opcional: sem ele (ou sem SMTP_HOST) o código vai só para o log do container
let transport = null;
if (config.smtp.host) {
  try {
    const { default: nodemailer } = await import("nodemailer");
    transport = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    });
  } catch {
    console.warn("admin.mail: SMTP_HOST definido mas o pacote nodemailer não está instalado");
  }
}

const escape = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export async function sendAdminCode(email, code, ip) {
  const when = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const note = `Vale por 10 minutos. Pedido em ${when} a partir do IP ${ip}. Se não foi você, ignore.`;
  if (!transport) {
    console.warn(`admin.mail.desligado: código do painel: ${code}`);
    return false;
  }
  const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#0b0b10;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#f5f5f7">
  <div style="max-width:480px;margin:0 auto;padding:40px 24px">
    <p style="font-size:22px;font-weight:800;margin:0 0 20px;color:#ff2e9a">${escape(config.appName)}</p>
    <p>Código de acesso ao painel:</p>
    <p style="font-family:ui-monospace,Menlo,monospace;font-size:32px;letter-spacing:8px;background:#16161e;border:1px solid #2a2a36;border-radius:12px;padding:18px;text-align:center;color:#fff">${escape(code)}</p>
    <p style="color:#8e8e99;font-size:14px">${escape(note)}</p>
  </div></body></html>`;
  await transport.sendMail({
    from: { name: config.smtp.fromName, address: config.smtp.from || config.smtp.user },
    to: email,
    subject: `${code} é o seu código do painel ${config.appName}`,
    text: `Código do painel: ${code}\n\n${note}`,
    html,
  });
  return true;
}
