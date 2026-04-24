import { swaggerSpec } from "../src/config/swagger";
import * as fs from "fs";

fs.writeFileSync("swagger-output.json", JSON.stringify(swaggerSpec, null, 2));
console.log("Swagger spec written to swagger-output.json");
