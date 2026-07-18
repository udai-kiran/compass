import QRCode from "react-qr-code";

/**
 * A `upi://pay` deep link for a VPA. Any UPI app resolves it; the QR of this
 * string is scannable from GPay/PhonePe/etc. Amount is optional (paise → rupees).
 */
export function upiPayUri(vpa: string, payeeName?: string | null, amountPaise?: number | null): string {
  const params = new URLSearchParams({ pa: vpa, cu: "INR" });
  if (payeeName) params.set("pn", payeeName);
  if (amountPaise && amountPaise > 0) params.set("am", (amountPaise / 100).toFixed(2));
  return `upi://pay?${params.toString()}`;
}

/**
 * Renders a QR for a UPI string. Always on a white plate with quiet-zone padding
 * so it scans in both light and dark themes (a QR must stay dark-on-light).
 */
export function UpiQr({ value, size = 132 }: { value: string; size?: number }) {
  return (
    <div className="inline-block rounded-lg border border-slate-200 bg-white p-3">
      <QRCode
        value={value}
        size={size}
        style={{ height: "auto", width: size, maxWidth: "100%" }}
        bgColor="#FFFFFF"
        fgColor="#0F172A"
      />
    </div>
  );
}
