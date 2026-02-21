// Load environment variables from .env file
require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const QRCode = require("qrcode");
const fs = require("fs");
const crypto = require("crypto");

const app = express();

// Enable CORS (allows frontend from other domains)
app.use(cors());

// Parse incoming JSON requests
app.use(express.json());

// Connect to MongoDB Atlas
mongoose.connect(process.env.MONGO_URI, {
  writeConcern: { w: 1 }, // basic write mode (avoids replica issues)
});

// =========================
// 📦 TOKEN SCHEMA (Business Ready)
// =========================
const tokenSchema = new mongoose.Schema(
  {
    // Unique secure token stored inside QR
    token: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    // Product name for tracking
    productName: {
      type: String,
      required: true,
    },

    // Batch ID for business control
    batchId: {
      type: String,
      required: true,
    },

    // Reward amount
    amount: {
      type: Number,
      default: 0,
    },

    // Prevents reuse
    used: {
      type: Boolean,
      default: false,
    },

    // When QR was redeemed
    redeemedAt: {
      type: Date,
    },

    // Expiry date for QR validity
    expiryDate: {
      type: Date,
    },

    // When token was created
    createdAt: {
      type: Date,
      default: Date.now,
    },

    // Optional: Store customer phone later
    customerPhone: {
      type: String,
    },
  },
  { versionKey: false }, // Removes __v field
);

const Token = mongoose.model("Token", tokenSchema);

// =========================
// 🔐 Generate Secure Token
// =========================
function generateToken() {
  return crypto.randomBytes(16).toString("hex");
}

// =========================
// 🎟 Generate Tokens Route
// =========================
app.get("/generate-tokens", async (req, res) => {
  try {
    for (let i = 1; i <= 100; i++) {
      await Token.create({
        token: generateToken(),
        productName: "Elite Reward Product",
        batchId: "BATCH2026JAN",
        expiryDate: new Date("2026-12-31"),
      });
    }

    res.send("100 business-ready tokens created");
  } catch (err) {
    res.status(500).send("Error generating tokens");
  }
});

// =========================
// 🖼 Generate QR Images
// =========================
app.get("/generate-qrs", async (req, res) => {
  const tokens = await Token.find();

  // Create folder if not exists
  if (!fs.existsSync("./qrs")) {
    fs.mkdirSync("./qrs");
  }

  for (let t of tokens) {
    await QRCode.toFile(
      `./qrs/${t.token}.png`,
      `http://localhost:3000/${t.token}`, // Change after deployment
    );
  }

  res.send("QR codes generated");
});

// =========================
// 🎁 Redeem QR
// =========================
app.get("/redeem/:token", async (req, res) => {
  const tokenValue = req.params.token;

  const tokenDoc = await Token.findOne({ token: tokenValue });

  // Token not found
  if (!tokenDoc) {
    return res.status(404).json({ message: "Invalid QR" });
  }

  // Expiry check
  if (tokenDoc.expiryDate && new Date() > tokenDoc.expiryDate) {
    return res.status(400).json({ message: "QR expired" });
  }

  // Already used check
  if (tokenDoc.used) {
    return res.status(400).json({ message: "QR already used" });
  }

  // Assign reward
  tokenDoc.amount = 100; // can replace with random logic
  tokenDoc.used = true;
  tokenDoc.redeemedAt = new Date();

  await tokenDoc.save();

  res.json({ amount: tokenDoc.amount });
});
function adminAuth(req, res, next) {
  const password = req.headers["x-admin-password"];

  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  next();
}

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
// 📊 Admin Dashboard Stats (Protected)
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
// 📦 Product Wise Stats (Protected)
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
// 🌐 Serve Frontend Page
// =========================
app.use(express.static("public"));

app.get("/:token", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

// =========================
// 🚀 Start Server
// =========================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port", PORT));
