// Replaces the former tests that mutated the production singleton and local db.json.
import '../tests/setup-env';
await import('../tests/integration.test');
