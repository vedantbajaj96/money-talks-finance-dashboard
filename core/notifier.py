"""core/notifier.py — Email notifications via SMTP.

Uses Gmail SMTP with an App Password (Settings → Google → App passwords).
Config keys read from the user config:
  alert_email          — address to send TO (and FROM)
  alert_smtp_password  — Gmail App Password (16-char, no spaces)
"""
from __future__ import annotations

import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

logger = logging.getLogger(__name__)


def send_email(*, to: str, subject: str, body_html: str, smtp_password: str,
               from_email: str | None = None) -> None:
    """Send an HTML email via Gmail SMTP. Raises on failure.

    from_email — the admin sending address (defaults to `to` for self-send).
    smtp_password — App Password for from_email's Gmail account.
    """
    sender = from_email or to
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = sender
    msg["To"]      = to
    msg.attach(MIMEText(body_html, "html"))

    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
        server.login(sender, smtp_password)
        server.sendmail(sender, [to], msg.as_string())


def send_market_drop_alert(
    *,
    to: str,
    smtp_password: str,
    from_email: str | None = None,
    ticker: str,
    drop_pct: float,
    threshold_pct: float,
    price: float,
) -> None:
    color = "#ef4444"
    subject = f"Market Drop Alert — {ticker} fell {drop_pct:.1f}% today"
    body = f"""
    <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
      <h2 style="margin: 0 0 8px; font-size: 20px; color: #111;">Market Drop Alert</h2>
      <p style="margin: 0 0 24px; color: #6b7280; font-size: 14px;">MoneyTalk · {__import__('datetime').date.today().strftime('%B %d, %Y')}</p>

      <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 12px; padding: 20px 24px; margin-bottom: 24px;">
        <div style="font-size: 13px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 6px;">{ticker} Today</div>
        <div style="font-size: 32px; font-weight: 700; color: {color};">−{drop_pct:.1f}%</div>
        <div style="font-size: 13px; color: #6b7280; margin-top: 4px;">Closed at ${price:.2f} · your threshold: −{threshold_pct:.1f}%</div>
      </div>

      <p style="font-size: 14px; color: #374151; line-height: 1.6;">
        This is a potential DCA opportunity. If you've been waiting to deploy cash, today's dip may be a good entry point.
        <br><br>
        This is not financial advice — just the alert you set up.
      </p>

      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
      <p style="font-size: 12px; color: #9ca3af;">
        You're receiving this because you enabled market drop alerts in MoneyTalk.
        To disable, remove your alert email in Settings.
      </p>
    </div>
    """
    send_email(to=to, subject=subject, body_html=body, smtp_password=smtp_password, from_email=from_email)
    logger.info("[notifier] market drop alert sent to %s (%.1f%%)", to, drop_pct)


def send_dca_reminder(
    *,
    to: str,
    smtp_password: str,
    monthly_amount: float,
    total_amount: float,
    deposited_so_far: float,
    remaining: float,
) -> None:
    subject = "DCA Reminder — Time for your monthly investment"
    pct_done = (deposited_so_far / total_amount * 100) if total_amount > 0 else 0
    body = f"""
    <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
      <h2 style="margin: 0 0 8px; font-size: 20px; color: #111;">Monthly DCA Reminder</h2>
      <p style="margin: 0 0 24px; color: #6b7280; font-size: 14px;">MoneyTalk · {__import__('datetime').date.today().strftime('%B %d, %Y')}</p>

      <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 20px 24px; margin-bottom: 24px;">
        <div style="font-size: 13px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 6px;">This Month's Deposit</div>
        <div style="font-size: 32px; font-weight: 700; color: #16a34a;">${monthly_amount:,.0f}</div>
        <div style="font-size: 13px; color: #6b7280; margin-top: 4px;">${deposited_so_far:,.0f} deposited · ${remaining:,.0f} remaining · {pct_done:.0f}% done</div>
      </div>

      <p style="font-size: 14px; color: #374151; line-height: 1.6;">
        Time to make your scheduled Wealthfront deposit. Log in and transfer ${monthly_amount:,.0f} to stay on track with your plan.
      </p>
    </div>
    """
    send_email(to=to, subject=subject, body_html=body, smtp_password=smtp_password)
    logger.info("[notifier] DCA reminder sent to %s", to)


def send_portfolio_drop_alert(
    *,
    to: str,
    smtp_password: str,
    from_email: str | None = None,
    drop_pct: float,
    threshold_pct: float,
    current_value: float,
    prev_value: float,
) -> None:
    drop_dollars = prev_value - current_value
    subject = f"Portfolio Drop Alert — your portfolio fell {drop_pct:.1f}% today"
    body = f"""
    <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
      <h2 style="margin: 0 0 8px; font-size: 20px; color: #111;">Portfolio Drop Alert</h2>
      <p style="margin: 0 0 24px; color: #6b7280; font-size: 14px;">MoneyTalk · {__import__('datetime').date.today().strftime('%B %d, %Y')}</p>

      <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 12px; padding: 20px 24px; margin-bottom: 24px;">
        <div style="font-size: 13px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 6px;">Your Wealthfront Portfolio</div>
        <div style="font-size: 32px; font-weight: 700; color: #ef4444;">−{drop_pct:.1f}%</div>
        <div style="font-size: 13px; color: #6b7280; margin-top: 4px;">
          Down ${drop_dollars:,.0f} · now ${current_value:,.0f} · threshold: −{threshold_pct:.1f}%
        </div>
      </div>

      <p style="font-size: 14px; color: #374151; line-height: 1.6;">
        Your portfolio dropped more than your alert threshold today. This could be a good time
        to consider adding to your position if you have cash available.
        <br><br>
        This is not financial advice — just the alert you set up.
      </p>

      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
      <p style="font-size: 12px; color: #9ca3af;">Disable in MoneyTalk → Settings → Notifications.</p>
    </div>
    """
    send_email(to=to, subject=subject, body_html=body, smtp_password=smtp_password, from_email=from_email)
    logger.info("[notifier] portfolio drop alert sent to %s (%.1f%%)", to, drop_pct)


def send_daily_brief(
    *,
    to: str,
    smtp_password: str,
    from_email: str | None = None,
    market_data: dict,   # {ticker: {price, change_pct}} for SPY, QQQ, etc.
    ai_summary: str,
) -> None:
    import datetime as _dt
    today_str = _dt.date.today().strftime("%A, %B %d, %Y")
    subject = f"Market Brief — {_dt.date.today().strftime('%b %d')}"

    def row(ticker: str, d: dict) -> str:
        pct = d.get("change_pct", 0)
        color = "#16a34a" if pct >= 0 else "#ef4444"
        sign  = "+" if pct >= 0 else ""
        return (
            f"<tr>"
            f"<td style='padding:8px 12px;font-weight:600;color:#111;'>{ticker}</td>"
            f"<td style='padding:8px 12px;text-align:right;color:#6b7280;'>${d.get('price', 0):,.2f}</td>"
            f"<td style='padding:8px 12px;text-align:right;font-weight:700;color:{color};'>{sign}{pct:.2f}%</td>"
            f"</tr>"
        )

    rows_html = "".join(row(t, d) for t, d in market_data.items())

    body = f"""
    <div style="font-family: -apple-system, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 24px;">
      <h2 style="margin: 0 0 4px; font-size: 20px; color: #111;">Daily Market Brief</h2>
      <p style="margin: 0 0 24px; color: #6b7280; font-size: 14px;">MoneyTalk · {today_str}</p>

      <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; margin-bottom: 24px;">
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead>
            <tr style="background:#f3f4f6;">
              <th style="padding:8px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">Index / ETF</th>
              <th style="padding:8px 12px;text-align:right;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">Price</th>
              <th style="padding:8px 12px;text-align:right;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">Day</th>
            </tr>
          </thead>
          <tbody>{rows_html}</tbody>
        </table>
      </div>

      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:20px 24px;margin-bottom:24px;">
        <div style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px;">AI Summary</div>
        <p style="margin:0;font-size:14px;color:#1e40af;line-height:1.7;">{ai_summary}</p>
      </div>

      <p style="font-size:12px;color:#9ca3af;">MoneyTalk daily brief · disable in Settings → Notifications.</p>
    </div>
    """
    send_email(to=to, subject=subject, body_html=body, smtp_password=smtp_password, from_email=from_email)
    logger.info("[notifier] daily brief sent to %s", to)


def send_monthly_digest(
    *,
    to: str,
    smtp_password: str,
    from_email: str | None = None,
    month_label: str,
    portfolio_value: float,
    portfolio_change: float,
    portfolio_change_pct: float,
    spy_change_pct: float,
    fees_this_month: float,
    ai_summary: str,
) -> None:
    subject = f"Monthly Portfolio Digest — {month_label}"
    port_color = "#16a34a" if portfolio_change >= 0 else "#ef4444"
    port_sign  = "+" if portfolio_change >= 0 else "−"

    def stat(label: str, value: str, color: str = "#111") -> str:
        return (
            f"<div style='text-align:center;'>"
            f"<div style='font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:4px;'>{label}</div>"
            f"<div style='font-size:22px;font-weight:700;color:{color};font-variant-numeric:tabular-nums;'>{value}</div>"
            f"</div>"
        )

    body = f"""
    <div style="font-family:-apple-system,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;">
      <h2 style="margin:0 0 4px;font-size:20px;color:#111;">Monthly Portfolio Digest</h2>
      <p style="margin:0 0 24px;color:#6b7280;font-size:14px;">MoneyTalk · {month_label}</p>

      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:24px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:20px 16px;">
        {stat('Portfolio', f'${portfolio_value:,.0f}')}
        {stat('Month Return', f'{port_sign}{abs(portfolio_change_pct):.1f}%', port_color)}
        {stat('vs SPY', f'{"+"+f"{spy_change_pct:.1f}%" if spy_change_pct>=0 else f"{spy_change_pct:.1f}%"}', "#16a34a" if portfolio_change_pct >= spy_change_pct else "#ef4444")}
      </div>

      <div style="background:#fefce8;border:1px solid #fde68a;border-radius:12px;padding:16px 20px;margin-bottom:24px;font-size:13px;color:#78350f;">
        Advisory fee charged this month: <strong>${fees_this_month:.2f}</strong>
      </div>

      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:20px 24px;margin-bottom:24px;">
        <div style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px;">AI Summary</div>
        <p style="margin:0;font-size:14px;color:#1e40af;line-height:1.7;">{ai_summary}</p>
      </div>

      <p style="font-size:12px;color:#9ca3af;">MoneyTalk monthly digest · disable in Settings → Notifications.</p>
    </div>
    """
    send_email(to=to, subject=subject, body_html=body, smtp_password=smtp_password, from_email=from_email)
    logger.info("[notifier] monthly digest sent to %s (%s)", to, month_label)


def send_test_email(*, to: str, smtp_password: str) -> None:
    body = """
    <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;">
      <h2 style="margin:0 0 8px;font-size:20px;color:#111;">Test Email</h2>
      <p style="color:#6b7280;font-size:14px;">MoneyTalk notifications are working correctly.</p>
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:20px 24px;">
        <p style="margin:0;font-size:14px;color:#16a34a;font-weight:600;">Your email and SMTP password are configured correctly.</p>
      </div>
    </div>
    """
    send_email(to=to, subject="MoneyTalk — Test Email", body_html=body, smtp_password=smtp_password)
    logger.info("[notifier] test email sent to %s", to)
