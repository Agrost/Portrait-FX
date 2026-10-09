import test from "node:test";
import assert from "node:assert/strict";
import { FavoriteActors, normalizeFavorites } from "../scripts/favorite-actors.js";

function fixture({ canWrite = () => true, failFirst = false } = {}) {
  let saved = [];
  let attempt = 0;
  const writes = [], errors = [];
  const options = {
    read: () => structuredClone(saved), canWrite,
    write: async (next) => {
      if (failFirst && attempt++ === 0) throw new Error("save failed");
      saved = structuredClone(next); writes.push(saved);
    },
    onError: (error) => errors.push(error.message),
  };
  return { favorites: new FavoriteActors(options), options, writes, errors };
}

test("favorites recover from saved client data and toggling off preserves other actors", async () => {
  const { favorites, options } = fixture();
  await favorites.toggle("a"); await favorites.toggle("b");
  const reopened = new FavoriteActors(options);
  assert.deepEqual(reopened.state, ["a", "b"]);
  await reopened.toggle("a");
  assert.deepEqual(reopened.state, ["b"]);
});

test("rapid star clicks serialize without losing changes or storing duplicate IDs", async () => {
  const { favorites } = fixture();
  await Promise.all([favorites.toggle("a"), favorites.toggle("b"), favorites.toggle("a"), favorites.toggle("c")]);
  assert.deepEqual(favorites.state, ["b", "c"]);
});

test("a failed favorite save preserves the prior state and allows the next click", async () => {
  const { favorites, errors } = fixture({ failFirst: true });
  await assert.rejects(favorites.toggle("a"), /save failed/);
  assert.deepEqual(favorites.state, []);
  await favorites.toggle("b");
  assert.deepEqual(favorites.state, ["b"]);
  assert.deepEqual(errors, ["save failed"]);
});

test("favorite lists remain independent between clients and players cannot edit them", async () => {
  const first = fixture(), second = fixture({ canWrite: () => false });
  await first.favorites.toggle("a");
  assert.deepEqual(second.favorites.state, []);
  await assert.rejects(second.favorites.toggle("a"), /только GM/);
  assert.deepEqual(second.writes, []);
});

test("invalid favorite data is filtered and invalid actor IDs do not write settings", async () => {
  assert.deepEqual(normalizeFavorites(["a", null, "", 1, "a", "b"]), ["a", "b"]);
  assert.deepEqual(normalizeFavorites({ a: true }), []);
  const { favorites, writes } = fixture();
  await assert.rejects(favorites.toggle(""), /не выбран/);
  await assert.rejects(favorites.toggle(null), /не выбран/);
  assert.deepEqual(writes, []);
});
