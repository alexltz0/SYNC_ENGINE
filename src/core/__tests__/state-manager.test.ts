import { StateManager } from '../state-manager';

describe('StateManager', () => {
  let sm: StateManager;

  beforeEach(() => {
    sm = new StateManager();
  });

  afterEach(() => {
    sm.clear();
  });

  it('should create entities', () => {
    const entity = sm.createEntity('player', 'owner-1', { name: 'Test' });
    expect(entity.id).toBeDefined();
    expect(entity.type).toBe('player');
    expect(entity.ownerId).toBe('owner-1');
    expect(entity.data.name).toBe('Test');
    expect(entity.version).toBe(1);
    expect(sm.entityCount).toBe(1);
  });

  it('should get entity by id', () => {
    const entity = sm.createEntity('player', 'owner-1');
    const found = sm.getEntity(entity.id);
    expect(found).toBeDefined();
    expect(found!.id).toBe(entity.id);
  });

  it('should return undefined for missing entity', () => {
    expect(sm.getEntity('nonexistent')).toBeUndefined();
  });

  it('should update entity with set operation', () => {
    const entity = sm.createEntity('player', 'owner-1', { hp: 100 });
    const updated = sm.updateEntity(entity.id, [
      { op: 'set', path: 'hp', value: 80 },
    ]);

    expect(updated).toBeDefined();
    expect(updated!.data.hp).toBe(80);
    expect(updated!.version).toBe(2);
  });

  it('should update entity with increment operation', () => {
    const entity = sm.createEntity('player', 'owner-1', { score: 10 });
    sm.updateEntity(entity.id, [{ op: 'increment', path: 'score', value: 5 }]);
    const found = sm.getEntity(entity.id);
    expect(found!.data.score).toBe(15);
  });

  it('should update entity with delete operation', () => {
    const entity = sm.createEntity('player', 'owner-1', { temp: true, hp: 100 });
    sm.updateEntity(entity.id, [{ op: 'delete', path: 'temp' }]);
    const found = sm.getEntity(entity.id);
    expect(found!.data.temp).toBeUndefined();
    expect(found!.data.hp).toBe(100);
  });

  it('should update entity with append operation', () => {
    const entity = sm.createEntity('player', 'owner-1', { items: ['sword'] });
    sm.updateEntity(entity.id, [{ op: 'append', path: 'items', value: 'shield' }]);
    const found = sm.getEntity(entity.id);
    expect(found!.data.items).toEqual(['sword', 'shield']);
  });

  it('should update entity with remove operation', () => {
    const entity = sm.createEntity('player', 'owner-1', { items: ['sword', 'shield'] });
    sm.updateEntity(entity.id, [{ op: 'remove', path: 'items', value: 'sword' }]);
    const found = sm.getEntity(entity.id);
    expect(found!.data.items).toEqual(['shield']);
  });

  it('should handle nested path updates', () => {
    const entity = sm.createEntity('player', 'owner-1', { stats: { hp: 100 } });
    sm.updateEntity(entity.id, [{ op: 'set', path: 'stats.hp', value: 80 }]);
    const found = sm.getEntity(entity.id);
    expect((found!.data.stats as any).hp).toBe(80);
  });

  it('should delete entities', () => {
    const entity = sm.createEntity('player', 'owner-1');
    expect(sm.entityCount).toBe(1);
    const deleted = sm.deleteEntity(entity.id);
    expect(deleted).toBe(true);
    expect(sm.entityCount).toBe(0);
    expect(sm.getEntity(entity.id)).toBeUndefined();
  });

  it('should return false when deleting nonexistent entity', () => {
    expect(sm.deleteEntity('nonexistent')).toBe(false);
  });

  it('should get entities by type', () => {
    sm.createEntity('player', 'owner-1');
    sm.createEntity('player', 'owner-2');
    sm.createEntity('npc', 'system');

    const players = sm.getEntitiesByType('player');
    expect(players.length).toBe(2);
    const npcs = sm.getEntitiesByType('npc');
    expect(npcs.length).toBe(1);
  });

  it('should get entities by owner', () => {
    sm.createEntity('player', 'owner-1');
    sm.createEntity('item', 'owner-1');
    sm.createEntity('player', 'owner-2');

    const owned = sm.getEntitiesByOwner('owner-1');
    expect(owned.length).toBe(2);
  });

  it('should track version correctly', () => {
    expect(sm.currentVersion).toBe(0);
    const entity = sm.createEntity('player', 'owner-1');
    expect(sm.currentVersion).toBe(1);
    sm.updateEntity(entity.id, [{ op: 'set', path: 'x', value: 1 }]);
    expect(sm.currentVersion).toBe(2);
    sm.deleteEntity(entity.id);
    expect(sm.currentVersion).toBe(3);
  });

  it('should create and restore snapshots', () => {
    sm.createEntity('player', 'owner-1', { name: 'Alice' });
    sm.createEntity('player', 'owner-2', { name: 'Bob' });

    const snapshot = sm.createSnapshot();
    expect(snapshot.version).toBe(2);
    expect(snapshot.entities.size).toBe(2);

    sm.clear();
    expect(sm.entityCount).toBe(0);

    sm.loadSnapshot(snapshot);
    expect(sm.entityCount).toBe(2);
    expect(sm.currentVersion).toBe(2);
  });

  it('should get entity history', () => {
    const entity = sm.createEntity('player', 'owner-1', { hp: 100 });
    sm.updateEntity(entity.id, [{ op: 'set', path: 'hp', value: 90 }]);
    sm.updateEntity(entity.id, [{ op: 'set', path: 'hp', value: 80 }]);

    const history = sm.getEntityHistory(entity.id);
    expect(history.length).toBe(2);
    expect(history[0].fromVersion).toBe(1);
    expect(history[1].fromVersion).toBe(2);
  });

  it('should get deltas since a version', () => {
    const e1 = sm.createEntity('player', 'owner-1', { hp: 100 });
    sm.updateEntity(e1.id, [{ op: 'set', path: 'hp', value: 90 }]);
    sm.updateEntity(e1.id, [{ op: 'set', path: 'hp', value: 80 }]);
    const e2 = sm.createEntity('npc', 'system', { hp: 50 });
    sm.updateEntity(e2.id, [{ op: 'set', path: 'hp', value: 40 }]);

    // e1 has deltas: fromVersion=1, fromVersion=2; e2 has delta: fromVersion=1
    // getDeltasSince(2) returns deltas with fromVersion >= 2 → only the 2nd e1 delta
    const deltas = sm.getDeltasSince(2);
    expect(deltas.length).toBe(1);
    expect(deltas[0].entityId).toBe(e1.id);
  });

  it('should return null when updating nonexistent entity', () => {
    const result = sm.updateEntity('nonexistent', [{ op: 'set', path: 'x', value: 1 }]);
    expect(result).toBeNull();
  });

  it('should clear all state', () => {
    sm.createEntity('player', 'owner-1');
    sm.createEntity('player', 'owner-2');
    sm.clear();
    expect(sm.entityCount).toBe(0);
    expect(sm.currentVersion).toBe(0);
  });
});
