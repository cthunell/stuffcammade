// Suggested names for the bill and spending-category pickers.
// "common" shows up front, "more" sits behind a toggle, and anything else is "Add your own".
export const BILLS = {
  common: [
    'Rent / mortgage', 'Electricity', 'Gas / heating', 'Internet', 'Phone', 'Car payment',
    'Car insurance', 'Health insurance', 'Renters / home insurance', 'Credit card payment',
    'Student loan', 'Streaming services', 'Gym / fitness', 'Subscriptions & apps',
  ],
  more: [
    'HOA fees', 'Water / sewer / trash', 'Property tax', 'Home warranty', 'Childcare / daycare',
    'Tuition / school fees', 'Child support / alimony', 'Life insurance', 'Pet insurance',
    'Storage unit', 'Personal loan', 'Tax payment plan', 'Parking / tolls / transit pass',
    'Software / cloud storage', 'Domain / web hosting', 'Charitable giving', 'Business expenses',
    'Pest control / lawn care', 'Security system',
  ],
};

export const CATEGORIES = {
  common: [
    'Groceries', 'Dining out & coffee', 'Gas & transportation', 'Shopping', 'Entertainment',
    'Health & medical', 'Personal care', 'Household supplies',
  ],
  more: [
    'Kids & school', 'Pets', 'Home improvement', 'Hobbies', 'Travel', 'Gifts & donations',
    'Clothing', 'Car maintenance', 'Education & books', 'Electronics', 'Professional / networking',
    'Cash / ATM', 'Bank fees', 'Unplanned / buffer',
  ],
};

export const INCOME = {
  common: ['Paycheck', 'Side income', 'Benefits', 'Child support', 'Rental income'],
  more: ['Unemployment', 'Social Security', 'Pension', 'Freelance / gig work', 'Tips', 'Alimony', 'Investment income'],
};

// Savings goals. Kept in checking (set aside) unless the name suggests a separate account.
export const GOALS = {
  common: ['Emergency fund', 'Vacation / travel', 'Holiday gifts', 'Car repairs', 'Next car', 'Home down payment', 'Big purchase'],
  more: ['Wedding', 'Moving', 'Medical / deductible', 'Education', 'Pet care', 'Annual bills', 'Home repairs', 'New phone / computer', 'Kids’ activities', 'Giving'],
};
export const SAVINGS_BY_DEFAULT = ['Emergency fund', 'Home down payment', 'Next car'];
