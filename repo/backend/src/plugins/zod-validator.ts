import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import {
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';

/**
 * Wires Zod into Fastify's validation and serialization pipeline.
 *
 * After this plugin is registered, route schemas can use Zod objects directly:
 *
 *   app.withTypeProvider<ZodTypeProvider>().post('/foo', {
 *     schema: { body: z.object({ name: z.string() }) },
 *     handler: async (req) => req.body.name,  // typed as string
 *   });
 *
 * Validation failures automatically return HTTP 400 with Zod error details.
 */
async function zodValidatorPlugin(app: FastifyInstance) {
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
}

export default fp(zodValidatorPlugin, {
  name: 'zod-validator',
  fastify: '4.x',
});
