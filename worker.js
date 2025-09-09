// worker.js
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

// Import jobs
import"./jobs/employeeJob.js"
import"./jobs/financialJob.js"
import"./jobs/orderJob.js"
import"./jobs/opsJob.js"

mongoose
  .connect(process.env.MONGO_URL)
  .then(() => {
    console.log("✅ Worker connected to MongoDB");
    console.log("🕒 Jobs scheduler is now running...");
  })
  .catch((err) => console.error("❌ MongoDB connection error (worker):", err));
