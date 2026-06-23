import type { Config } from "jest";

const config: Config = {
  testEnvironment: "node",
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: { jsx: "react-jsx" } }],
  },
  moduleNameMapper: {
    "\\.(css|less|scss|sass)$": "<rootDir>/__mocks__/styleMock.js",
  },
  // Ignore stale git worktrees so their duplicate mocks/tests don't run or warn.
  testPathIgnorePatterns: ["/node_modules/", "/.worktrees/"],
  modulePathIgnorePatterns: ["/.worktrees/"],
};

export default config;
