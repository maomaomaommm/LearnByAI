const s1 = "$ " + " ".repeat(100000) + "a\n";
console.time("regex1");
s1.replace(/(?<!\$)\$\s+([^$\n]*?[^\s$\n])\s+\$(?!\$)/g, "$$$1$$");
console.timeEnd("regex1");
