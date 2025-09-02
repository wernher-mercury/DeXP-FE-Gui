// netlify/functions/download-zip.js
const archiver = require('archiver');
const { PassThrough } = require('stream');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { filesData } = JSON.parse(event.body || '{}');
    // filesData: [{ name: "xxx.webp", dataUrl: "data:image/webp;base64,...." }, ...]

    if (!Array.isArray(filesData) || filesData.length === 0) {
      return { statusCode: 400, body: JSON.stringify({ success: false, error: 'filesData가 필요합니다.' }) };
    }

    // archiver를 메모리로
    const archive = archiver('zip', { zlib: { level: 9 } });
    const stream = new PassThrough();
    const chunks = [];

    stream.on('data', (c) => chunks.push(c));

    const finalizePromise = new Promise((resolve, reject) => {
      stream.on('end', resolve);
      stream.on('error', reject);
    });

    archive.on('error', (err) => stream.emit('error', err));
    archive.pipe(stream);

    for (const item of filesData) {
      if (!item?.dataUrl || !item?.name) continue;
      const base64 = item.dataUrl.split(',')[1] || '';
      const buf = Buffer.from(base64, 'base64');
      archive.append(buf, { name: item.name });
    }

    await archive.finalize();
    // archiver가 stream에 모두 write하고 end될 때까지 대기
    await finalizePromise;

    const zipBuffer = Buffer.concat(chunks);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="webp_images.zip"',
      },
      body: zipBuffer.toString('base64'),
      isBase64Encoded: true,
    };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ success: false, error: error.message }) };
  }
};
