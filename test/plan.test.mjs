import test from "node:test";
import assert from "node:assert/strict";

import {
  defineMigration,
  planMigrations,
  MigrationValidationError,
} from "../dist/index.js";

const noop = () => {};

test("returns pending migrations from the current version", () => {
  const migrations = [
    defineMigration(1, { name: "a", up: noop }),
    defineMigration(2, { name: "b", up: noop }),
    defineMigration(3, { name: "c", up: noop }),
  ];

  const plan = planMigrations(1, migrations);
  assert.deepEqual(
    plan.pending.map((m) => m.version),
    [2, 3],
  );
  assert.equal(plan.targetVersion, 3);
  assert.equal(plan.currentVersion, 1);
  assert.deepEqual(plan.warnings, []);
});

test("sorts out-of-order migrations before planning", () => {
  const migrations = [
    defineMigration(3, { name: "c", up: noop }),
    defineMigration(1, { name: "a", up: noop }),
    defineMigration(2, { name: "b", up: noop }),
  ];

  const plan = planMigrations(0, migrations);
  assert.deepEqual(
    plan.pending.map((m) => m.version),
    [1, 2, 3],
  );
});

test("already-current database has no pending migrations", () => {
  const migrations = [
    defineMigration(1, { name: "a", up: noop }),
    defineMigration(2, { name: "b", up: noop }),
  ];

  const plan = planMigrations(2, migrations);
  assert.deepEqual(plan.pending, []);
  assert.equal(plan.targetVersion, 2);
});

test("throws on duplicate versions", () => {
  const migrations = [
    defineMigration(1, { name: "a", up: noop }),
    defineMigration(1, { name: "a-again", up: noop }),
  ];

  assert.throws(
    () => planMigrations(0, migrations),
    (err) => {
      assert.ok(err instanceof MigrationValidationError);
      assert.match(err.message, /Duplicate migration version 1/);
      return true;
    },
  );
});

test("throws on non-positive-integer versions", () => {
  for (const bad of [0, -1, 1.5, Number.NaN]) {
    assert.throws(
      () => planMigrations(0, [defineMigration(bad, { name: "x", up: noop })]),
      MigrationValidationError,
      `version ${String(bad)} should be rejected`,
    );
  }
});

test("warns on gaps but still plans them", () => {
  const migrations = [
    defineMigration(1, { name: "a", up: noop }),
    defineMigration(3, { name: "c", up: noop }),
  ];

  const plan = planMigrations(0, migrations);
  assert.deepEqual(
    plan.pending.map((m) => m.version),
    [1, 3],
  );
  assert.equal(plan.warnings.length, 1);
  assert.match(plan.warnings[0], /Gap in migration versions: 1 -> 3/);
});

test("empty migration set keeps the current version", () => {
  const plan = planMigrations(5, []);
  assert.deepEqual(plan.pending, []);
  assert.equal(plan.targetVersion, 5);
});
