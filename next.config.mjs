const legacyPages = ["login", "reset-password", "privacy", "terms", "schedule"];

export default {
  experimental: {
    // Leave documents travel in a Server Action's form body (up to 4 MB,
    // src/lib/hrms/leave/schemas.ts). Next's default is 1 MB; Vercel caps a
    // function request at 4.5 MB, so this matches the platform limit.
    serverActions: { bodySizeLimit: "4.5mb" },
  },
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/", destination: "/index.html" },
        ...legacyPages.map((p) => ({ source: `/${p}`, destination: `/${p}.html` })),
      ],
    };
  },
};
