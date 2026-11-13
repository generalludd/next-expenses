import * as migration_20261112_170902 from './20261112_170902';
import * as migration_20261113_194055_add_must_change_password from './20261113_194055_add_must_change_password';

export const migrations = [
  {
    up: migration_20261112_170902.up,
    down: migration_20261112_170902.down,
    name: '20261112_170902',
  },
  {
    up: migration_20261113_194055_add_must_change_password.up,
    down: migration_20261113_194055_add_must_change_password.down,
    name: '20261113_194055_add_must_change_password'
  },
];
