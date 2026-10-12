// Whether the directory a posix Host socket sits in is private to this user, asked by the Host before it binds
// and by every client before it connects. The check is the SDK package's (packages/client/src/socketDir.ts).
export { privateDirProblem, unsafeSocketDir } from '../publicContract'
