# Vito Skills

Skills extend Vito's capabilities by providing tools (function calling) and documentation.

Skills are loaded fresh from disk on every message — no restart or reload needed. Just add/edit the files and they're live.

## 📁 Structure

Each skill is a directory containing:

```
skill-name/
├── SKILL.md         # Documentation (frontmatter + usage guide)
├── index.js         # Tool definitions and exports (optional)
└── *.mjs            # Helper scripts (optional)
```

### SKILL.md

The `SKILL.md` file contains:
- **Frontmatter** (name, description)
- **Documentation** (when to use, how to use, examples)

```markdown
---
name: my-skill
description: A short description of what this skill does
---

# My Skill

Detailed documentation here...
```

### index.js (Optional)

Export a `skill` object with tools for function calling:

```javascript
export const skill = {
  name: 'my-skill',
  description: 'A short description',
  tools: [
    {
      name: 'tool_name',
      description: 'What this tool does',
      input_schema: {
        type: 'object',
        properties: {
          param1: { type: 'string', description: 'What param1 is for' },
        },
        required: ['param1'],
      },
      async execute({ param1 }) {
        return `Result: ${param1}`;
      },
    },
  ],
};
export default skill;
```

## 🚀 Adding Skills

1. Create a directory: `user/skills/your-skill/`
2. Add a `SKILL.md` with frontmatter and docs
3. Optionally add `index.js` with tool definitions
4. Start chatting — Vito picks up skills automatically

See `example/` for a starter template.
