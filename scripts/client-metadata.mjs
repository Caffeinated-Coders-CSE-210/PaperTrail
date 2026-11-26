import { createClientMetadata } from '../src/features/auth/oauthConfig.ts'
if (process.argv.length !== 3) throw new Error('Usage: node --experimental-strip-types scripts/client-metadata.mjs https://your-deployment.example')
process.stdout.write(`${JSON.stringify(createClientMetadata(process.argv[2]), null, 2)}\n`)
