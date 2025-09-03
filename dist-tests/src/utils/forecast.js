// Mock implementation of your existing calculateForecast function
// Replace this with import from your actual utils/forecast.js
export function calculateForecast(input) {
    const { startDate, initialBalance, payDates, depositPerCycle, bills, buffer } = input;
    // Create timeline of events
    const events = [];
    // Add pay deposits
    payDates.forEach(date => {
        events.push({
            date,
            amount: depositPerCycle,
            description: `Deposit (€${depositPerCycle.toFixed(2)})`
        });
    });
    // Add bills
    bills.forEach(bill => {
        events.push({
            date: bill.dueDate,
            amount: -bill.amount,
            description: bill.name
        });
    });
    // Sort events by date
    events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    // Calculate running balance (only from startDate onward)
    const timeline = [];
    let currentBalance = initialBalance;
    let minBalance = currentBalance;
    // Add starting point
    timeline.push({ date: startDate, balance: currentBalance });
    const startTs = new Date(startDate).getTime();
    const futureEvents = events.filter(e => new Date(e.date).getTime() >= startTs);
    futureEvents.forEach(event => {
        currentBalance += event.amount;
        timeline.push({
            date: event.date,
            balance: currentBalance,
            event: event.description
        });
        if (currentBalance < minBalance) {
            minBalance = currentBalance;
        }
    });
    return {
        minBalance: minBalance - buffer,
        endBalance: currentBalance,
        timeline
    };
}
