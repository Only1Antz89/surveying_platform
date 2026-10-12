import {describe,it,expect} from "vitest";
import {personalConversationHistory} from "./workspace-conversation-scope";
describe("personal Surveyant history authorization",()=>{
 const messages=[{role:"user",content:"Review this case"},{role:"assistant",content:"Saved case answer",citations:[{id:"job:own"}]}];
 it("retains an answer while all its cited assignments remain permitted",()=>expect(personalConversationHistory(messages,new Set(["job:own"]))).toEqual(messages));
 it("does not replay an answer or its question after reassignment",()=>expect(personalConversationHistory(messages,new Set(["job:other"]))).toEqual([]));
 it("does not replay finance or uncited answers into personal surveying",()=>{expect(personalConversationHistory([{role:"assistant",citations:[{id:"business:finance-totals"}]}],new Set(["job:own"]))).toEqual([]);expect(personalConversationHistory([{role:"assistant"}],new Set(["job:own"]))).toEqual([]);});
});
