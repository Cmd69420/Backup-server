import crypto from "crypto";

export const verifyLmsSignature = (req, res, next) => {
  const signature = req.headers["x-lms-signature"];
  if (!signature) {
    return res.status(401).json({ error: "MissingSignature" });
  }

  const expected = crypto
    .createHmac("sha256", process.env.LMS_WEBHOOK_SECRET)
    .update(JSON.stringify(req.body))
    .digest("hex");

  if (signature !== expected) {
    return res.status(401).json({ error: "InvalidSignature" });
  }

  next();
};
