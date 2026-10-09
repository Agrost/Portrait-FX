import test from "node:test";
import assert from "node:assert/strict";
import { ActorCategories, normalizeCategories } from "../scripts/actor-categories.js";

function fixture(initial = {}, options = {}) {
  let saved = structuredClone(initial), allowed = true;
  const errors = [], writes = [];
  const config = { read: () => saved, canWrite: () => allowed,
    write: async (next) => { saved = structuredClone(next); writes.push(next); },
    onError: (error) => errors.push(error.message), ...options };
  const categories = new ActorCategories(config);
  return { categories, config, errors, writes, deny: () => { allowed = false; }, read: () => saved };
}

test("category names and multiple memberships survive reopening and renaming keeps memberships", async () => {
  const { categories, config, read } = fixture();
  await categories.save("factions", " Фракции ");
  await categories.save("regions", "Страны");
  await categories.assign("actor", "factions", true);
  await categories.assign("actor", "regions", true);
  await categories.save("factions", "Союзы");
  const reopened = new ActorCategories(config);
  assert.deepEqual(reopened.state, read());
  assert.deepEqual(reopened.state.assignments.actor, ["factions", "regions"]);
  assert.equal(reopened.state.categories[0].name, "Союзы");
  await reopened.assign("actor", "factions", false);
  assert.deepEqual(read().assignments.actor, ["regions"]);
});

test("queued category assignments read the latest saved memberships instead of overwriting each other", async () => {
  const { categories, read } = fixture({ categories: [{ id: "a", name: "A" }, { id: "b", name: "B" }] });
  await Promise.all([categories.assign("actor", "a", true), categories.assign("actor", "b", true), categories.assign("actor", "a", true)]);
  assert.deepEqual(read().assignments.actor, ["a", "b"]);
});

test("invalid names, duplicate names, missing categories and player writes leave saved data unchanged", async () => {
  const { categories, writes, deny } = fixture();
  await categories.save("a", "Страны");
  for (const operation of [() => categories.save("b", " "), () => categories.save("b", " страны "), () => categories.assign("actor", "missing", true)]) {
    await assert.rejects(operation());
  }
  deny(); await assert.rejects(categories.save("a", "Новая"), /GM/);
  assert.equal(writes.length, 1);
  assert.equal(categories.state.categories[0].name, "Страны");
});

test("failed persistence does not change local categories and a subsequent edit still saves", async () => {
  let fail = true;
  const { categories, read } = fixture({}, { write: async (next) => {
    if (fail) throw new Error("offline");
    return next;
  } });
  await assert.rejects(categories.save("a", "A"), /offline/);
  assert.deepEqual(categories.state.categories, []);
  fail = false;
  await categories.save("b", "B");
  assert.deepEqual(categories.state.categories, [{ id: "b", name: "B" }]);
  assert.deepEqual(read(), {});
});

test("corrupt categories and memberships normalize without retaining unknown or duplicate IDs", () => {
  assert.deepEqual(normalizeCategories({ categories: [null, { id: "a", name: " A " }, { id: "a", name: "Duplicate" }, { id: "b", name: "" }],
    assignments: { actor: ["a", "a", "unknown"], bad: null } }),
  { categories: [{ id: "a", name: "A" }], assignments: { actor: ["a"] } });
  assert.deepEqual(normalizeCategories(null), { categories: [], assignments: {} });
});
