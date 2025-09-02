// netlify/functions/convert.js
const Busboy = require('busboy');
const sharp = require('sharp');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const contentType = event.headers['content-type'] || event.headers['Content-Type'] || '';
    if (!contentType.startsWith('multipart/form-data')) {
      return { statusCode: 400, body: JSON.stringify({ success: false, error: 'multipart/form-data 가 아닙니다.' }) };
    }

    const files = [];
    let quality = 85;

    await new Promise((resolve, reject) => {
      const busboy = Busboy({ headers: { 'content-type': contentType } });

      busboy.on('file', (fieldname, file, filename, encoding, mimetype) => {
        const chunks = [];
        file.on('data', (d) => chunks.push(d));
        file.on('end', () => {
          files.push({
            fieldname,
            originalName: filename,
            mimetype,
            buffer: Buffer.concat(chunks),
          });
        });
      });

      busboy.on('field', (fieldname, val) => {
        if (fieldname === 'quality') {
          const q = parseInt(val, 10);
          if (!Number.isNaN(q) && q >= 50 && q <= 100) quality = q;
        }
      });

      busboy.on('error', reject);
      busboy.on('finish', resolve);

      // Netlify는 base64 인코딩으로 body를 전달할 수 있음
      const body = event.isBase64Encoded ? Buffer.from(event.body, 'base64') : Buffer.from(event.body || '');
      busboy.end(body);
    });

    if (files.length === 0) {
      return { statusCode: 400, body: JSON.stringify({ success: false, error: '업로드된 파일이 없습니다.' }) };
    }

    // 변환
    const results = await Promise.all(
      files.map(async (f) => {
        try {
          const t = Date.now();
          const id = Math.random().toString(36).slice(2, 8);
          const convertedName = `${t}_${id}_${(f.originalName || 'image').replace(/\.[^.]+$/, '')}.webp`;

          const pipeline = sharp(f.buffer).webp({
            quality,
            effort: 6,
            lossless: quality === 100,
          });

          const convertedBuffer = await pipeline.toBuffer();
          const meta = await sharp(convertedBuffer).metadata();

          const originalSize = f.buffer.length;
          const convertedSize = convertedBuffer.length;
          const reduction = Math.round((1 - convertedSize / originalSize) * 100);

          const dataUrl = `data:image/webp;base64,${convertedBuffer.toString('base64')}`;

          return {
            originalName: f.originalName,
            convertedName,
            originalSize,
            convertedSize,
            reduction,
            url: dataUrl, // 프론트에서 <img src> / 다운로드에 바로 사용
            width: meta.width,
            height: meta.height,
            format: 'webp',
          };
        } catch (e) {
          return { error: e.message, originalName: f.originalName };
        }
      })
    );

    const successful = results.filter((r) => !r.error);
    const errors = results.filter((r) => r.error).map((r) => ({ file: r.originalName, error: r.error }));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        files: successful,
        errors,
        stats: {
          total: results.length,
          successful: successful.length,
          failed: errors.length,
        },
      }),
    };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ success: false, error: error.message }) };
  }
};
