'use strict';
const { query } = require('../db');
const { ApiError } = require('../errors');

function formatItem(row) {
  return { id: row.id, name: row.name, price: Number(row.price), active: row.active };
}

async function listItems({ activeOnly = false } = {}) {
  const where = activeOnly ? 'WHERE active' : '';
  const { rows } = await query(
    `SELECT id, name, price, active FROM items ${where} ORDER BY price ASC, id ASC`
  );
  return rows.map(formatItem);
}

async function createItem(input) {
  try {
    const { rows } = await query(
      `INSERT INTO items (id, name, price, active) VALUES ($1, $2, $3, $4)
       RETURNING id, name, price, active`,
      [input.id, input.name, input.price, input.active]
    );
    return formatItem(rows[0]);
  } catch (err) {
    if (err.code === '23505') throw new ApiError(409, 'item_exists', 'Item already exists');
    throw err;
  }
}

async function updateItem(id, patch) {
  const sets = [];
  const params = [id];
  for (const key of ['name', 'price', 'active']) {
    if (patch[key] !== undefined) {
      params.push(patch[key]);
      sets.push(`${key} = $${params.length}`);
    }
  }
  sets.push('updated_at = now()');
  const { rows } = await query(
    `UPDATE items SET ${sets.join(', ')} WHERE id = $1
     RETURNING id, name, price, active`,
    params
  );
  if (!rows[0]) throw new ApiError(404, 'item_not_found', 'Item not found');
  return formatItem(rows[0]);
}

module.exports = { listItems, createItem, updateItem, formatItem };
