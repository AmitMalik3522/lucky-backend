// =========================
// 🌍 Load Environment Variables
// =========================
require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const QRCode = require("qrcode");
const fs = require("fs");
const crypto = require("crypto");

const app = express();

// =========================
// ⚙ Middleware
// =========================
app.use(cors());
app.use(express.json());

// =========================
// 🗄 Connect to MongoDB Atlas
// =========================
mongoose.connect(process.env.MONGO_URI);

mongoose.connection.on("connected", () => {
  console.log("✅ MongoDB connected");
});

mongoose.connection.on("error", (err) => {
  console.error("❌ MongoDB connection error:", err);
});

// =========================
// 📦 TOKEN SCHEMA
// =========================
const tokenSchema = new mongoose.Schema(
  {
    token: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    productName: {
      type: String,
      required: true,
    },
    batchId: {
      type: String,
      required: true,
    },
    amount: {
      type: Number,
      default: 0,
    },
    used: {
      type: Boolean,
      default: false,
    },
    redeemedAt: {
      type: Date,
    },
    expiryDate: {
      type: Date,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    customerPhone: {
      type: String,
    },
  },
  { versionKey: false },
);

const Token = mongoose.model("Token", tokenSchema);

// =========================
// 🔐 Admin Authentication Middleware
// =========================
function adminAuth(req, res, next) {
  const password = req.headers["x-admin-password"];

  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  next();
}

// =========================
// 🔐 Generate Secure Token
// =========================
function generateToken() {
  return crypto.randomBytes(16).toString("hex");
}

// =========================
// 🎟 Generate Tokens (Protected)
// =========================
app.get("/generate-tokens", adminAuth, async (req, res) => {
  try {
    for (let i = 1; i <= 100; i++) {
      await Token.create({
        token: generateToken(),
        productName: "Elite Reward Product",
        batchId: "BATCH2026JAN",
        expiryDate: new Date("2026-12-31"),
      });
    }

    res.send("✅ 100 business-ready tokens created");
  } catch (err) {
    res.status(500).send("Error generating tokens");
  }
});

// =========================
// 🖼 Generate QR Images (Protected)
// =========================
app.get("/generate-qrs", adminAuth, async (req, res) => {
  try {
    const tokens = await Token.find();

    if (!fs.existsSync("./qrs")) {
      fs.mkdirSync("./qrs");
    }

    for (let t of tokens) {
      await QRCode.toFile(
        `./qrs/${t.token}.png`,
        `${process.env.BASE_URL}/${t.token}`,
      );
    }

    res.send("✅ QR codes generated");
  } catch (err) {
    res.status(500).send("Error generating QR codes");
  }
});
// =========================
// 📦 Download All QRs as ZIP (Protected)
// =========================
const archiver = require("archiver");

app.get("/download-qrs", adminAuth, async (req, res) => {
  try {
    const tokens = await Token.find();

    if (!fs.existsSync("./qrs")) {
      return res
        .status(400)
        .json({ message: "QR folder not found. Generate QRs first." });
    }

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", "attachment; filename=all-qrs.zip");

    const archive = archiver("zip", {
      zlib: { level: 9 },
    });

    archive.pipe(res);

    for (let t of tokens) {
      const filePath = `./qrs/${t.token}.png`;
      if (fs.existsSync(filePath)) {
        archive.file(filePath, { name: `${t.token}.png` });
      }
    }

    await archive.finalize();
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error creating ZIP file" });
  }
});

// =========================
// 🎁 Redeem QR
// =========================
app.get("/redeem/:token", async (req, res) => {
  try {
    const tokenValue = req.params.token;
    const tokenDoc = await Token.findOne({ token: tokenValue });

    if (!tokenDoc) {
      return res.status(404).json({ message: "Invalid QR" });
    }

    if (tokenDoc.expiryDate && new Date() > tokenDoc.expiryDate) {
      return res.status(400).json({ message: "QR expired" });
    }

    if (tokenDoc.used) {
      return res.status(400).json({ message: "QR already used" });
    }

    tokenDoc.amount = 100;
    tokenDoc.used = true;
    tokenDoc.redeemedAt = new Date();

    await tokenDoc.save();

    res.json({ amount: tokenDoc.amount });
  } catch (err) {
    res.status(500).json({ message: "Redemption error" });
  }
});

// =========================
// 📊 Admin Dashboard Stats
// =========================
app.get("/admin/stats", adminAuth, async (req, res) => {
  try {
    const totalQrs = await Token.countDocuments();
    const redeemed = await Token.countDocuments({ used: true });
    const remaining = await Token.countDocuments({ used: false });

    const payout = await Token.aggregate([
      { $match: { used: true } },
      {
        $group: {
          _id: null,
          totalPaid: { $sum: "$amount" },
        },
      },
    ]);

    res.json({
      totalQrs,
      redeemed,
      remaining,
      totalPaid: payout[0]?.totalPaid || 0,
    });
  } catch (err) {
    res.status(500).json({ error: "Dashboard error" });
  }
});

// =========================
// 📦 Product Wise Stats
// =========================
app.get("/admin/product-stats", adminAuth, async (req, res) => {
  try {
    const stats = await Token.aggregate([
      {
        $group: {
          _id: "$productName",
          total: { $sum: 1 },
          redeemed: {
            $sum: { $cond: ["$used", 1, 0] },
          },
        },
      },
    ]);

    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: "Product stats error" });
  }
});

// =========================
// 🌐 Serve Frontend
// =========================
app.use(express.static("public"));

app.get("/:token", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

// =========================
// 🚀 Start Server
// =========================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
