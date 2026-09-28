// Available in every runtime this engine runs on (Workers, Node, browsers),
// but not part of the ES lib the engine is typed against.
declare function structuredClone<T>(value: T): T;

export const clone = <T>(value: T): T => structuredClone(value);
