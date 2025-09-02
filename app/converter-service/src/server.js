// app/convert-service/src/server.js
const express = require("express");
const multer = require("multer");
const sharp = require("sharp");
const path = require("path");
const fs = require("fs");
const archiver = require("archiver");
const cors = require("cors");
const morgan = require("morgan");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const app = express();
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || "localhost";

// 디렉토리 설정
const BASE_DIR = path.join(__dirname, "..");
const UPLOAD_DIR = path.join(BASE_DIR, "uploads");
const CONVERTED_DIR = path.join(BASE_DIR, "converted");
const PUBLIC_DIR = path.join(BASE_DIR, "public");

// 디렉토리 생성
[UPLOAD_DIR, CONVERTED_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`📁 Created directory: ${dir}`);
  }
});

// 미들웨어 설정
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "*",
    credentials: true,
  })
);
app.use(morgan("dev"));
app.use(express.json());
app.use(express.static(PUBLIC_DIR));
app.use("/converted", express.static(CONVERTED_DIR));

// Multer 설정
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE || 50) * 1024 * 1024, // MB to bytes
    files: parseInt(process.env.MAX_FILES || 20),
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/bmp",
      "image/webp",
      "image/tiff",
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`지원하지 않는 파일 형식: ${file.mimetype}`), false);
    }
  },
});

// 라우트: 메인 페이지
app.get("/", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

// 라우트: 헬스 체크
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    service: "convert-service",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// 라우트: 서비스 정보
app.get("/api/info", (req, res) => {
  res.json({
    service: "WebP Conversion Service",
    version: "1.0.0",
    capabilities: {
      maxFileSize: `${process.env.MAX_FILE_SIZE || 50}MB`,
      maxFiles: process.env.MAX_FILES || 20,
      supportedFormats: ["JPEG", "PNG", "GIF", "BMP", "TIFF"],
      outputFormat: "WebP",
    },
  });
});

// 라우트: 이미지 변환
app.post("/api/convert", upload.array("images"), async (req, res) => {
  const startTime = Date.now();

  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        error: "업로드된 파일이 없습니다.",
      });
    }

    const quality = parseInt(req.body.quality) || 85;
    const convertedFiles = [];
    const errors = [];

    console.log(
      `🔄 Converting ${req.files.length} files with quality ${quality}%`
    );

    // 병렬 처리
    const conversionPromises = req.files.map(async (file) => {
      try {
        const timestamp = Date.now();
        const randomStr = Math.random().toString(36).substring(7);
        const outputFileName = `${timestamp}_${randomStr}_${
          path.parse(file.originalname).name
        }.webp`;
        const outputPath = path.join(CONVERTED_DIR, outputFileName);

        // Sharp를 사용한 변환
        const info = await sharp(file.buffer)
          .webp({
            quality: quality,
            effort: 6, // 압축 노력 (0-6, 높을수록 느리지만 품질 좋음)
            lossless: quality === 100, // 100% 품질일 때 무손실
          })
          .toFile(outputPath);

        const stats = fs.statSync(outputPath);

        return {
          originalName: file.originalname,
          convertedName: outputFileName,
          originalSize: file.size,
          convertedSize: stats.size,
          reduction: Math.round((1 - stats.size / file.size) * 100),
          url: `/converted/${outputFileName}`,
          width: info.width,
          height: info.height,
          format: info.format,
        };
      } catch (error) {
        console.error(
          `❌ Error converting ${file.originalname}:`,
          error.message
        );
        errors.push({
          file: file.originalname,
          error: error.message,
        });
        return null;
      }
    });

    const results = await Promise.all(conversionPromises);
    const successfulConversions = results.filter((r) => r !== null);

    const processingTime = Date.now() - startTime;
    console.log(
      `✅ Converted ${successfulConversions.length}/${req.files.length} files in ${processingTime}ms`
    );

    res.json({
      success: true,
      files: successfulConversions,
      errors: errors,
      stats: {
        total: req.files.length,
        successful: successfulConversions.length,
        failed: errors.length,
        processingTime: processingTime,
      },
    });
  } catch (error) {
    console.error("❌ Conversion error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "이미지 변환 중 오류가 발생했습니다.",
    });
  }
});

// 라우트: ZIP 다운로드
app.post("/api/download-zip", express.json(), async (req, res) => {
  try {
    const files = req.body.files;

    if (!files || files.length === 0) {
      return res.status(400).json({
        success: false,
        error: "다운로드할 파일이 없습니다.",
      });
    }

    console.log(`📦 Creating ZIP with ${files.length} files`);

    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=webp_images.zip"
    );

    const archive = archiver("zip", {
      zlib: { level: 9 },
    });

    archive.on("error", (err) => {
      throw err;
    });

    archive.pipe(res);

    let addedFiles = 0;
    for (const fileName of files) {
      const filePath = path.join(CONVERTED_DIR, fileName);
      if (fs.existsSync(filePath)) {
        archive.file(filePath, { name: fileName });
        addedFiles++;
      }
    }

    if (addedFiles === 0) {
      return res.status(404).json({
        success: false,
        error: "요청한 파일을 찾을 수 없습니다.",
      });
    }

    await archive.finalize();
    console.log(`✅ ZIP created with ${addedFiles} files`);
  } catch (error) {
    console.error("❌ ZIP creation error:", error);
    res.status(500).json({
      success: false,
      error: "ZIP 파일 생성 중 오류가 발생했습니다.",
    });
  }
});

// 라우트: 파일 삭제
app.delete("/api/converted/:filename", (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(CONVERTED_DIR, filename);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`🗑️ Deleted file: ${filename}`);
      res.json({ success: true, message: "파일이 삭제되었습니다." });
    } else {
      res
        .status(404)
        .json({ success: false, error: "파일을 찾을 수 없습니다." });
    }
  } catch (error) {
    console.error("❌ File deletion error:", error);
    res
      .status(500)
      .json({ success: false, error: "파일 삭제 중 오류가 발생했습니다." });
  }
});

// 정리 작업: 오래된 파일 삭제
const cleanupInterval =
  parseInt(process.env.CLEANUP_INTERVAL || 60) * 60 * 1000; // 분 -> 밀리초
const fileMaxAge = parseInt(process.env.FILE_MAX_AGE || 24) * 60 * 60 * 1000; // 시간 -> 밀리초

setInterval(() => {
  const now = Date.now();

  [CONVERTED_DIR, UPLOAD_DIR].forEach((dir) => {
    fs.readdir(dir, (err, files) => {
      if (err) return;

      files.forEach((file) => {
        const filePath = path.join(dir, file);
        fs.stat(filePath, (err, stats) => {
          if (err) return;

          if (now - stats.mtimeMs > fileMaxAge) {
            fs.unlink(filePath, (err) => {
              if (!err) {
                console.log(`🧹 Cleaned up old file: ${file}`);
              }
            });
          }
        });
      });
    });
  });
}, cleanupInterval);

// 에러 핸들링 미들웨어
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === "FILE_TOO_LARGE") {
      return res.status(400).json({
        success: false,
        error: `파일 크기가 너무 큽니다. 최대 ${
          process.env.MAX_FILE_SIZE || 50
        }MB까지 허용됩니다.`,
      });
    }
    if (error.code === "LIMIT_FILE_COUNT") {
      return res.status(400).json({
        success: false,
        error: `파일 개수가 너무 많습니다. 최대 ${
          process.env.MAX_FILES || 20
        }개까지 허용됩니다.`,
      });
    }
  }

  console.error("❌ Unhandled error:", error);
  res.status(500).json({
    success: false,
    error: error.message || "서버 오류가 발생했습니다.",
  });
});

// 404 핸들러
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Not Found",
    path: req.path,
  });
});

// 서버 시작
const server = app.listen(PORT, HOST, () => {
  console.log(`
╔════════════════════════════════════════════════╗
║                                                ║
║     🎨 WebP Conversion Service Started!        ║
║                                                ║
║     Service: @gui/convert-service              ║
║     URL: http://${HOST}:${PORT}                     ║
║     API: http://${HOST}:${PORT}/api                  ║
║                                                ║
║     Environment: ${process.env.NODE_ENV || "development"}                   ║
║     Max File Size: ${process.env.MAX_FILE_SIZE || 50}MB                   ║
║     Max Files: ${process.env.MAX_FILES || 20}                         ║
║                                                ║
╚════════════════════════════════════════════════╝
    `);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("📛 SIGTERM signal received: closing HTTP server");
  server.close(() => {
    console.log("🛑 HTTP server closed");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("📛 SIGINT signal received: closing HTTP server");
  server.close(() => {
    console.log("🛑 HTTP server closed");
    process.exit(0);
  });
});

module.exports = app;
