const fs = require('fs');
const path = require('path');

const fixSchemaNames = (filePath, schemaNames) => {
  let content = fs.readFileSync(filePath, 'utf8');
  let modified = false;
  
  schemaNames.forEach(schemaName => {
    const lines = content.split('\n');
    let processedCount = 0;
    
    for (let i = 0; i < lines.length; i++) {
      if (/^export const\s+=\s+z/.test(lines[i])) {
        // Find the next usage of any schema name after this line
        let found = false;
        for (let j = i + 1; j < lines.length && j < i + 50; j++) {
          if (lines[j].includes(schemaName + '.parse') || lines[j].includes(schemaName + '.safeParse')) {
            if (processedCount === 0) {
              lines[i] = lines[i].replace(/^export const\s+=/, `export const ${schemaName} =`);
              modified = true;
              found = true;
              processedCount++;
              break;
            }
          }
        }
        if (!found) {
          processedCount++;
        }
      }
    }
    
    if (modified) {
      content = lines.join('\n');
    }
  });
  
  if (modified) {
    fs.writeFileSync(filePath, content, 'utf8');
    return true;
  }
  return false;
};

const controllersDir = './src/controllers';
const schemas = {
  "burnController.ts": ["bodySchema"],
  "fiatController.ts": ["faucetSchema", "onRampSchema", "offRampSchema"],
  "investmentController.ts": ["requestSchema", "getWithdrawRequestsQuerySchema"],
  "mintController.ts": ["usdcBodySchema", "depositBodySchema"],
  "onrampController.ts": ["bodySchema"],
  "recoveryController.ts": ["unlockAppSchema", "verifyRecoveryOtpSchema"],
  "salaryController.ts": ["postSalaryDisburseSchema", "postSalaryScheduleSchema"],
  "transactionController.ts": ["listTransactionsQuerySchema"],
  "transferController.ts": ["getTransfersQuerySchema"],
  "userController.ts": ["patchMeSchema", "addContactSchema", "addGuardianSchema", "walletConfirmSchema"]
};

const fixed = [];
Object.entries(schemas).forEach(([file, names]) => {
  const filePath = path.join(controllersDir, file);
  if (fixSchemaNames(filePath, names)) {
    fixed.push(file);
  }
});

console.log('Fixed files:', fixed.join(', '));
