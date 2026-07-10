import { MockDB } from './lib/mock-db';
import { v4 as uuidv4 } from 'uuid';

async function testSaveCompany() {
    console.log("Testing MockDB.saveCompany...");
    try {
        await MockDB.saveCompany({
            id: uuidv4(),
            name: "Empresa Teste " + Date.now(),
            industry: "TI",
            phone: "11999999999"
        });
        console.log("Save company success!");
    } catch (e: any) {
        console.error("Save company error:", e.message);
    }
}

testSaveCompany();
