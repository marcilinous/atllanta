const legacyPages = ["login", "reset-password", "privacy", "terms", "schedule"];

export default {
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/", destination: "/index.html" },
        ...legacyPages.map((p) => ({ source: `/${p}`, destination: `/${p}.html` })),
      ],
    };
  },
};
