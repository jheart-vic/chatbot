// middleware/auth.js
import jwt from "jsonwebtoken";
export const requireAdmin = (req,res,next) => {
  const token = (req.headers.authorization || "").replace("Bearer ","");
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.role !== "admin") return res.status(403).json({error:"Forbidden"});
    req.user = payload;
    next();
  } catch {
    res.status(401).json({error:"Unauthorized"});
  }
};
