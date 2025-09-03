import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cors from "cors";

import userRoutes from "./routes/userRoutes.js";
import orderRoutes from "./routes/orderRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";
import feedbackRoutes from "./routes/feedbackRoutes.js";
import staffAlertRoutes from "./routes/staffAlertRoutes.js";
import whatsappRoutes from "./routes/whatsappRoutes.js";
// import paymentRoutes from "./routes/paymentRoutes.js";

import"./jobs/employeeJob.js"
import"./jobs/equipmentJob.js"
import"./jobs/financialJob.js"
import"./jobs/inventoryJob.js"
import"./jobs/orderJob.js"
import "./jobs/reminderJob.js";


dotenv.config();

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());

// Routes
app.use("/api/users", userRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/feedback", feedbackRoutes);
app.use("/api/alerts", staffAlertRoutes);
app.use("/api/whatsapp", whatsappRoutes);
// app.use("/api/payments", paymentRoutes);





// Health check
app.get("/", (req, res) => {
  res.send("CHUVI AI Backend running ✅");
});

// MongoDB connection
mongoose
  .connect(process.env.MONGO_URL,)
  .then(() => {
    console.log("MongoDB connected");
    app.listen(process.env.PORT || 5000, () => {
      console.log(`Server running on port ${process.env.PORT || 5000}`);
    });
  })
  .catch((err) => console.error("MongoDB connection error:", err));
