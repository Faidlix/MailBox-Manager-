// Render email HTML in an isolated document and export paged canvas slices.
// Slicing keeps long messages below mobile browsers' canvas size limits.
const blobDataUrl = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error('無法讀取信件圖片'));
  reader.readAsDataURL(blob);
});

export async function createMessagePdf(message, embeddedImages, filename) {
  if (!globalThis.html2canvas || !globalThis.jspdf?.jsPDF) throw new Error('PDF 元件尚未載入，請稍後重試');
  const parsed = new DOMParser().parseFromString(message.html_body || '<html><body></body></html>', 'text/html');
  if (!message.html_body) {
    const pre = parsed.createElement('pre');
    pre.style.cssText = 'white-space:pre-wrap;font:16px/1.7 sans-serif';
    pre.textContent = message.text_body || message.snippet || '';
    parsed.body.append(pre);
  }
  parsed.querySelectorAll('script,iframe,object,embed,form,base,meta[http-equiv],link').forEach((node) => node.remove());
  parsed.querySelectorAll('*').forEach((node) => {
    for (const attr of [...node.attributes]) if (/^on/i.test(attr.name)) node.removeAttribute(attr.name);
  });
  for (const image of parsed.querySelectorAll('img')) {
    const source = image.getAttribute('src') || '';
    if (source.startsWith('cid:')) {
      const file = embeddedImages.find((item) => item.contentId === source.slice(4));
      if (!file) throw new Error('找不到信件內嵌圖片，無法完整匯出 PDF');
      image.src = await blobDataUrl(file);
    } else if (/^https?:/i.test(source)) {
      // Download once rather than letting canvas silently omit CORS-blocked images.
      const response = await fetch(source, { credentials: 'omit', signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('信件圖片載入失敗，請稍後重試');
      image.src = await blobDataUrl(await response.blob());
    }
    image.removeAttribute('srcset');
    image.removeAttribute('loading');
  }
  const policy = parsed.createElement('meta');
  policy.httpEquiv = 'Content-Security-Policy';
  policy.content = "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:";
  parsed.head.prepend(policy);
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-same-origin');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:760px;height:1000px;border:0;pointer-events:none';
  const loaded = new Promise((resolve, reject) => {
    frame.onload = resolve;
    frame.onerror = () => reject(new Error('無法準備 PDF 畫面'));
  });
  frame.srcdoc = '<!doctype html>' + parsed.documentElement.outerHTML;
  document.body.append(frame);
  try {
    await loaded;
    const doc = frame.contentDocument;
    await Promise.all([...doc.images].map((image) => image.decode()));
    await doc.fonts.ready;
    const width = Math.max(760, doc.body.scrollWidth);
    frame.style.width = `${width}px`;
    const height = Math.max(doc.body.scrollHeight, doc.body.offsetHeight);
    const pageHeight = Math.floor(width * 277 / 190);
    const pdf = new globalThis.jspdf.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
    pdf.setProperties({ title: message.subject || '信件', author: message.sender_name || message.sender_email || '' });
    for (let y = 0; y < height; y += pageHeight) {
      const sliceHeight = Math.min(pageHeight, height - y);
      const canvas = await globalThis.html2canvas(doc.body, {
        x: 0, y, width, height: sliceHeight, scale: 1.5,
        windowWidth: width, windowHeight: 1000, scrollX: 0, scrollY: 0,
        backgroundColor: '#ffffff', logging: false, useCORS: true,
      });
      if (y) pdf.addPage();
      pdf.addImage(canvas.toDataURL('image/jpeg', .95), 'JPEG', 10, 10, 190, sliceHeight * 190 / width);
      canvas.width = 0; canvas.height = 0;
    }
    return new File([pdf.output('blob')], filename, { type: 'application/pdf' });
  } finally { frame.remove(); }
}
