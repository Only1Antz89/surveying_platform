const document = {
  openapi: "3.1.0",
  info: { title: "FIELDNOTE API", version: "1.0.0", description: "Tenant-scoped operational API for FIELDNOTE web and mobile clients." },
  servers: [{ url: "/api/v1" }],
  security: [{ clerkBearer: [] }],
  components: { securitySchemes: { clerkBearer: { type: "http", scheme: "bearer", bearerFormat: "JWT" } } },
  paths: {
    "/overview": { get: { summary: "Get the operational overview", responses: { "200": { description: "Overview" } } } },
    "/clients": { get: { summary: "List clients", responses: { "200": { description: "Client page" } } }, post: { summary: "Create a client", responses: { "200": { description: "Created client" } } } },
    "/clients/{id}": { patch: { summary: "Update or archive a client with optimistic concurrency", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], responses: { "200": { description: "Updated client" }, "409": { description: "Version conflict" } } } },
    "/properties": { get: { summary: "List properties", responses: { "200": { description: "Property page" } } }, post: { summary: "Create a property", responses: { "200": { description: "Created property" } } } },
    "/properties/{id}": { patch: { summary: "Update or archive a property with optimistic concurrency", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], responses: { "200": { description: "Updated property" }, "409": { description: "Version conflict" } } } },
    "/jobs": { get: { summary: "List jobs", responses: { "200": { description: "Job page" } } }, post: { summary: "Create a job", responses: { "200": { description: "Created job" } } } },
    "/jobs/{id}": { get: { summary: "Get a job", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], responses: { "200": { description: "Job" } } }, patch: { summary: "Update a job with optimistic concurrency", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], responses: { "200": { description: "Updated job" }, "409": { description: "Version conflict" }, "422": { description: "Invalid stage transition" } } } },
    "/team": { get: { summary: "List team members", responses: { "200": { description: "Team" } } } },
    "/team/{id}": { patch: { summary: "Change an active member role", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], responses: { "200": { description: "Updated membership" }, "409": { description: "Final owner protection" } } }, delete: { summary: "Remove an active member", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], responses: { "200": { description: "Removed membership" }, "409": { description: "Final owner protection" } } } },
    "/team/invitations": { post: { summary: "Invite a team member", responses: { "200": { description: "Invitation" } } } },
    "/support-sessions/{id}": { patch: { summary: "Approve or deny a pending support write-access request as a tenant owner", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], responses: { "200": { description: "Support access decision recorded" }, "403": { description: "Owner role required" }, "409": { description: "Request expired or no longer pending" } } } },
    "/organisation": { get: { summary: "Get the active organisation", responses: { "200": { description: "Organisation" } } }, patch: { summary: "Update practice settings", responses: { "200": { description: "Updated organisation" } } } },
  },
} as const;

export function GET() { return Response.json(document); }
