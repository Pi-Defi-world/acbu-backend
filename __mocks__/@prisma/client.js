const { v4: uuidv4 } = require('uuid');

// Shared in-memory stores across all mock PrismaClient instances so tests
// and app code using different PrismaClient instances see the same data.
const GLOBAL_PRISMA_STORES = global.__PRISMA_MOCK_STORES || (global.__PRISMA_MOCK_STORES = new Map());

function matchWhere(record, where) {
  if (!where) return true;
  for (const [k, v] of Object.entries(where)) {
    if (v && typeof v === 'object' && (v.gte || v.lte || v.gt || v.lt)) {
      const val = new Date(record[k]).getTime();
      if (v.gte && val < new Date(v.gte).getTime()) return false;
      if (v.gt && val <= new Date(v.gt).getTime()) return false;
      if (v.lte && val > new Date(v.lte).getTime()) return false;
      if (v.lt && val >= new Date(v.lt).getTime()) return false;
    } else if (typeof v === 'object' && v !== null) {
      if (JSON.stringify(record[k]) !== JSON.stringify(v)) return false;
    } else {
      if (record[k] !== v) return false;
    }
  }
  return true;
}

class MockModel {
  constructor(store, name) {
    this.store = store;
    this.name = name;
  }

  async create({ data }) {
    const id = data.id || uuidv4();
    const now = new Date();
    const rec = { ...data, id, createdAt: now, updatedAt: now };
    this.store.set(id, rec);
    return rec;
  }

  async findUnique({ where }) {
    for (const rec of this.store.values()) {
      if (matchWhere(rec, where)) return rec;
    }
    return null;
  }

  async findFirst({ where }) {
    return this.findUnique({ where });
  }

  async findMany({ where } = {}) {
    // Support common Prisma options: where, select, distinct, orderBy, take, skip
    const opts = arguments[0] || {};
    const { where: w, select, distinct, orderBy, take, skip } = opts;
    let out = [];
    for (const rec of this.store.values()) {
      if (matchWhere(rec, w)) out.push(rec);
    }

    // Handle ordering (simple single-field asc/desc)
    if (orderBy && typeof orderBy === 'object') {
      const key = Object.keys(orderBy)[0];
      const dir = orderBy[key];
      out.sort((a, b) => {
        const av = a[key];
        const bv = b[key];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        if (dir === 'asc') return av > bv ? 1 : av < bv ? -1 : 0;
        return av < bv ? 1 : av > bv ? -1 : 0;
      });
    }

    // Apply skip/take
    if (typeof skip === 'number') out = out.slice(skip);
    if (typeof take === 'number') out = out.slice(0, take);

    // Handle distinct: dedupe by the listed fields
    if (Array.isArray(distinct) && distinct.length > 0) {
      const seen = new Set();
      const uniq = [];
      for (const r of out) {
        const key = JSON.stringify(distinct.reduce((acc, f) => ({ ...acc, [f]: r[f] }), {}));
        if (!seen.has(key)) {
          seen.add(key);
          uniq.push(r);
        }
      }
      out = uniq;
    }

    // Handle select projection
    if (select && typeof select === 'object') {
      return out.map((r) => {
        const obj = {};
        for (const k of Object.keys(select)) {
          if (select[k]) obj[k] = r[k];
        }
        return obj;
      });
    }

    return out;
  }

  async update({ where, data }) {
    const rec = await this.findUnique({ where });
    if (!rec) throw new Error('Record not found');
    const updated = { ...rec, ...data, updatedAt: new Date() };
    this.store.set(updated.id, updated);
    return updated;
  }

  async delete({ where }) {
    const rec = await this.findUnique({ where });
    if (!rec) return null;
    this.store.delete(rec.id);
    return rec;
  }

  async deleteMany({ where } = {}) {
    let count = 0;
    const ids = [];
    for (const rec of this.store.values()) {
      if (matchWhere(rec, where)) ids.push(rec.id);
    }
    for (const id of ids) { this.store.delete(id); count++; }
    return { count };
  }

  async count({ where } = {}) {
    let n = 0;
    for (const rec of this.store.values()) if (matchWhere(rec, where)) n++;
    return n;
  }

  async upsert({ where, update, create }) {
    const rec = await this.findUnique({ where });
    if (rec) return this.update({ where, data: update });
    return this.create({ data: create });
  }

  async aggregate({ where, _sum } = {}) {
    const out = { _sum: {} };
    // Only implement _sum.deployedNotionalUsd used by tests
    if (_sum && _sum.deployedNotionalUsd) {
      let total = 0;
      for (const rec of this.store.values()) {
        if (matchWhere(rec, where)) {
          const v = rec.deployedNotionalUsd;
          const n = v && typeof v === 'object' && typeof v.toNumber === 'function' ? v.toNumber() : Number(v || 0);
          total += n;
        }
      }
      out._sum.deployedNotionalUsd = total;
    }
    return out;
  }
}

class PrismaClient {
  constructor() {
    this._stores = new Map();
    this._middlewares = [];
    // Define common model instances directly on the client so tests that
    // call `new PrismaClient()` get properties like `prisma.user.create`.
    const modelNames = [
      'user',
      'recoveryAttempt',
      'userDevice',
      'userSession',
      'salaryBatch',
      'salaryItem',
      'salarySchedule',
      'transaction',
      'webhook',
      'oracleRate',
      'reserve',
      'reserveHistory',
      'apiKey',
    ];
    for (const name of modelNames) {
      try {
        this[name] = new MockModel(this._getStore(name), name);
      } catch (e) {
        // ignore
      }
    }
    // Provide a `model(name)` accessor
    this.model = (name) => new MockModel(this._getStore(name), name);

    // Return a proxy so unknown model properties are created on-demand,
    // while explicit properties assigned above remain available.
    return new Proxy(this, {
      get(target, prop) {
        if (prop in target) return target[prop];
        const name = String(prop);
        return new MockModel(target._getStore(name), name);
      },
    });
  }

  // Return a proxy from the constructor so unknown model getters are
  // handled dynamically (e.g., prisma.anyModel)
  // Note: returning an object from a constructor replaces the `this` value.
  static _createProxy(instance) {
    return new Proxy(instance, {
      get(target, prop) {
        if (prop in target) return target[prop];
        const name = String(prop);
        return new MockModel(target._getStore(name), name);
      },
    });
  }

  // Adapt constructor return to provide proxy behavior
  constructorProxy() {
    return PrismaClient._createProxy(this);
  }

  _getStore(model) {
    if (!GLOBAL_PRISMA_STORES.has(model)) GLOBAL_PRISMA_STORES.set(model, new Map());
    return GLOBAL_PRISMA_STORES.get(model);
  }

  get [Symbol.for('nodejs.util.inspect.custom')]() { return () => 'PrismaClientMock'; }

  $use(fn) { this._middlewares.push(fn); }
  $on() { /* noop */ }
  async $connect() { return; }
  async $disconnect() { return; }

  /**
   * Minimal $transaction support. If passed a function, call it with a
   * transactional client (same API here). If passed an array, run queries
   * sequentially and return results.
   */
  async $transaction(arg) {
    if (typeof arg === 'function') {
      // Call callback with this proxy so model getters work inside
      return await arg(this);
    }
    if (Array.isArray(arg)) {
      const results = [];
      for (const op of arg) {
        if (typeof op === 'function') results.push(await op(this));
        else results.push(undefined);
      }
      return results;
    }
    return null;
  }
  $extends(ext) { return this; }

  get user() { return new MockModel(this._getStore('user'), 'user'); }
  get recoveryAttempt() { return new MockModel(this._getStore('recoveryAttempt'), 'recoveryAttempt'); }
  get userDevice() { return new MockModel(this._getStore('userDevice'), 'userDevice'); }
  get userSession() { return new MockModel(this._getStore('userSession'), 'userSession'); }
  get salaryBatch() { return new MockModel(this._getStore('salaryBatch'), 'salaryBatch'); }
  get salaryItem() { return new MockModel(this._getStore('salaryItem'), 'salaryItem'); }
  get salarySchedule() { return new MockModel(this._getStore('salarySchedule'), 'salarySchedule'); }
  get transaction() { return new MockModel(this._getStore('transaction'), 'transaction'); }
  get webhook() { return new MockModel(this._getStore('webhook'), 'webhook'); }
  get oracleRate() { return new MockModel(this._getStore('oracleRate'), 'oracleRate'); }
  get reserve() { return new MockModel(this._getStore('reserve'), 'reserve'); }
  get reserveHistory() { return new MockModel(this._getStore('reserveHistory'), 'reserveHistory'); }
  get apiKey() { return new MockModel(this._getStore('apiKey'), 'apiKey'); }

  model(name) {
    return new MockModel(this._getStore(name), name);
  }
}

// Minimal Prisma error types used in tests
const Prisma = {
  PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {
    constructor(message, { code } = {}) {
      super(message);
      this.code = code;
      this.name = 'PrismaClientKnownRequestError';
    }
  },
};

module.exports = { PrismaClient, Prisma };
