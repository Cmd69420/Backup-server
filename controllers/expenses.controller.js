import { pool } from "../db.js";

export const createExpense = async (req, res) => {
  const {
    start_location,
    end_location,
    travel_date,
    distance_km,
    transport_mode,
    amount_spent,
    currency = "₹",
    notes,
    receipt_urls,
    client_id
  } = req.body;

  const result = await pool.query(
    `INSERT INTO trip_expenses
    (user_id, start_location, end_location, travel_date, distance_km,
     transport_mode, amount_spent, currency, notes, receipt_urls, client_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    RETURNING *`,
    [
      req.user.id,
      start_location,
      end_location,
      travel_date,
      distance_km,
      transport_mode,
      amount_spent,
      currency,
      notes,
      receipt_urls || [],
      client_id || null
    ]
  );

  res.status(201).json({
    message: "Expense created successfully",
    expense: result.rows[0],
  });
};

export const getMyTotal = async (req, res) => {
  const result = await pool.query(
    `SELECT COALESCE(SUM(amount_spent), 0) as total_amount
     FROM trip_expenses
     WHERE user_id = $1`,
    [req.user.id]
  );

  res.json({
    totalAmount: parseFloat(result.rows[0].total_amount)
  });
};

export const getMyExpenses = async (req, res) => {
  const { startDate, endDate, transportMode, clientId } = req.query;

  let query = `SELECT * FROM trip_expenses WHERE user_id = $1`;
  const params = [req.user.id];
  let count = 1;

  if (startDate) {
    count++;
    query += ` AND travel_date >= ${count}`;
    params.push(startDate);
  }
  if (endDate) {
    count++;
    query += ` AND travel_date <= ${count}`;
    params.push(endDate);
  }
  if (transportMode) {
    count++;
    query += ` AND transport_mode = ${count}`;
    params.push(transportMode);
  }
  if (clientId) {
    count++;
    query += ` AND client_id = ${count}`;
    params.push(clientId);
  }

  query += ` ORDER BY travel_date DESC`;

  const result = await pool.query(query, params);

  res.json({
    expenses: result.rows,
    total: result.rows.length,
    totalAmount: result.rows.reduce((sum, e) => sum + Number(e.amount_spent), 0),
  });
};

export const uploadReceipt = async (req, res) => {
  const { imageData, fileName } = req.body;

  if (!imageData) {
    return res.status(400).json({ error: "ImageRequired" });
  }

  const buffer = Buffer.from(imageData, "base64");
  const randomName = `${Date.now()}-${fileName || "receipt.jpg"}`;
  const url = `https://storage.yourdomain.com/receipts/${randomName}`;

  console.log("Receipt upload simulated:", randomName);

  res.json({ url, fileName: randomName });
};

export const getExpenseById = async (req, res) => {
  const result = await pool.query(
    `SELECT * FROM trip_expenses WHERE id = $1 AND user_id = $2`,
    [req.params.id, req.user.id]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "ExpenseNotFound" });
  }

  res.json({ expense: result.rows[0] });
};

export const updateExpense = async (req, res) => {
  const {
    start_location,
    end_location,
    travel_date,
    distance_km,
    transport_mode,
    amount_spent,
    currency = "₹",
    notes,
    receipt_urls,
    client_id
  } = req.body;

  const result = await pool.query(
    `UPDATE trip_expenses
     SET start_location = $1,
         end_location = $2,
         travel_date = $3,
         distance_km = $4,
         transport_mode = $5,
         amount_spent = $6,
         currency = $7,
         notes = $8,
         receipt_urls = $9,
         client_id = $10,
         updated_at = NOW()
     WHERE id = $11 AND user_id = $12
     RETURNING *`,
    [
      start_location,
      end_location,
      travel_date,
      distance_km,
      transport_mode,
      amount_spent,
      currency,
      notes,
      receipt_urls || [],
      client_id || null,
      req.params.id,
      req.user.id
    ]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "ExpenseNotFound" });
  }

  res.json({
    message: "Expense updated successfully",
    expense: result.rows[0],
  });
};

export const deleteExpense = async (req, res) => {
  const result = await pool.query(
    `DELETE FROM trip_expenses WHERE id = $1 AND user_id = $2 RETURNING id`,
    [req.params.id, req.user.id]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "ExpenseNotFound" });
  }

  res.status(204).send();
};