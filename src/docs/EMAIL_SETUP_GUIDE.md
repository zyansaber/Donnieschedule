# Email Setup Guide

## EmailJS Setup Instructions

1. **Create an EmailJS Account**
   - Go to [EmailJS](https://www.emailjs.com/)
   - Sign up for an account

2. **Add an Email Service**
   - In the EmailJS Dashboard, go to "Email Services"
   - Click "Add New Service"
   - Select your email provider (Gmail, Outlook, etc.)
   - Follow the authentication steps

3. **Create Templates**
   - Go to "Email Templates"
   - Click "Create New Template"

### Note Template Setup
1. Create a template with ID `template_barjtqgp`
2. Add the following variables:
   - `{{from_name}}`: Sender name (will be "Schedule Dashboard")
   - `{{message}}`: The note content
   - `{{selected_chassis}}`: List of selected chassis
   - `{{chassis_count}}`: Number of selected chassis

### Reminder Template Setup
1. Create a new template with a name like "reminder_template"
2. Add the following variables:
   - `{{from_name}}`: Sender name (will be "Schedule Dashboard")
   - `{{chassis}}`: The chassis number
   - `{{note}}`: The reminder note
   - `{{date}}`: The reminder date
   - `{{model}}`: The chassis model (if available)
   - `{{customer}}`: The customer name (if available)

3. Suggested template content:
```html
<h2>Van Production Reminder</h2>
<p>This is an automated reminder for chassis {{chassis}}</p>

<div style="margin: 20px 0; padding: 15px; border: 1px solid #ddd; border-radius: 5px;">
  <h3>Reminder Details</h3>
  <p><strong>Date:</strong> {{date}}</p>
  <p><strong>Note:</strong> {{note}}</p>
</div>

<h3>Van Information</h3>
<table style="width: 100%; border-collapse: collapse;">
  <tr style="background-color: #f2f2f2;">
    <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Chassis</th>
    <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Model</th>
    <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Customer</th>
  </tr>
  <tr>
    <td style="border: 1px solid #ddd; padding: 8px;">{{chassis}}</td>
    <td style="border: 1px solid #ddd; padding: 8px;">{{model}}</td>
    <td style="border: 1px solid #ddd; padding: 8px;">{{customer}}</td>
  </tr>
</table>

<p style="font-style: italic; margin-top: 20px;">This is an automated message from the Schedule Dashboard.</p>
```

4. After creating the template, note its ID (example: `template_reminder123`)

## Updating Your Code

Add your reminder template ID to the `ReminderModal.jsx` file:

```javascript
// In src/components/ReminderModal.jsx

// Update this constant with your template ID
const REMINDER_TEMPLATE_ID = 'template_reminder123';
```

## Testing Your Setup

1. Create a reminder with a valid email address
2. Send a test email to verify your template works correctly