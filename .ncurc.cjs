module.exports = {
  target: (name, semver) => {
    if (
      name.startsWith("@angular/") ||
      name.startsWith("@angular-devkit/") ||
      name.startsWith("@angular-eslint/") ||
      name.startsWith("@types/node")
    ) {
      return "minor";
    }

    return "latest";
  },
  reject: (name, semver) => {
    if (name === "typescript") {
      return true;
    }

    return false;
  },
};
