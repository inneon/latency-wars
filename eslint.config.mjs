import nx from "@nx/eslint-plugin";

export default [
    ...nx.configs["flat/base"],
    ...nx.configs["flat/typescript"],
    ...nx.configs["flat/javascript"],
    {
      "ignores": [
        "**/dist",
        "**/out-tsc",
        "**/vite.config.*.timestamp*",
        "**/vitest.config.*.timestamp*"
      ]
    },
    {
        files: [
            "**/*.ts",
            "**/*.tsx",
            "**/*.js",
            "**/*.jsx"
        ],
        rules: {
            "@nx/enforce-module-boundaries": [
                "error",
                {
                    enforceBuildableLibDependency: true,
                    allow: [
                        "^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$"
                    ],
                    // Hexagonal dependency direction. Apps are composition roots and may
                    // depend on anything; contracts/core depend only inward.
                    depConstraints: [
                        { sourceTag: "type:app", onlyDependOnLibsWithTags: ["type:core", "type:adapter", "type:contracts", "type:util"] },
                        { sourceTag: "type:adapter", onlyDependOnLibsWithTags: ["type:core", "type:contracts", "type:util"] },
                        { sourceTag: "type:core", onlyDependOnLibsWithTags: ["type:contracts", "type:util"] },
                        { sourceTag: "type:contracts", onlyDependOnLibsWithTags: ["type:util"] },
                        { sourceTag: "type:util", onlyDependOnLibsWithTags: ["type:util"] }
                    ]
                }
            ]
        }
    },
    {
        files: [
            "**/*.ts",
            "**/*.tsx",
            "**/*.cts",
            "**/*.mts",
            "**/*.js",
            "**/*.jsx",
            "**/*.cjs",
            "**/*.mjs"
        ],
        // Override or add rules here
        rules: {}
    }
];
