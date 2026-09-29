const document = {
  openapi: "3.1.0",
  info: { title: "FIELDNOTE API", version: "1.0.0", description: "Tenant-scoped operational API for FIELDNOTE web and mobile clients." },
  servers: [{ url: "/api/v1" }],
  security: [{ clerkBearer: [] }],
  components: { securitySchemes: { clerkBearer: { type: "http", scheme: "bearer", bearerFormat: "JWT" } } },
  paths: {
    "/overview": { get: { summary: "Get the operational overview", responses: { "200": { description: "Overview" } } } },
    "/clients": { get: { summary: "List clients", responses: { "200": { description: "Client page" } } }, post: { summary: "Create a client", responses: { "200": { description: "Created client" } } } },
    "/properties": { get: { summary: "List properties", responses: { "200": { description: "Property page" } } }, post: { summary: "Create a property", responses: { "200": { description: "Created property" } } } },
    "/jobs": { get: { summary: "List jobs", responses: { "200": { description: "Job page" } } }, post: { summary: "Create a job", responses: { "200": { description: "Created job" } } } },
    "/jobs/{id}": { get: { summary: "Get a job", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], responses: { "200": { description: "Job" } } }, patch: { summary: "Update a job with optimistic concurrency", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], responses: { "200": { description: "Updated job" }, "409": { description: "Version conflict" }, "422": { description: "Invalid stage transition" } } } },
    "/team": { get: { summary: "List team members", responses: { "200": { description: "Team" } } } },
    "/team/invitations": { post: { summary: "Invite a team member", responses: { "200": { description: "Invitation" } } } },
    "/organisation": { get: { summary: "Get the active organisation", responses: { "200": { description: "Organisation" } } } },
  },
} as const;

export function GET() { return Response.json(document); }
