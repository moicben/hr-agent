/* 1. Start to process each stored contact with "status" column at "ready"
    SPECIFICATIONS:
    - Select the older contact with "status" "new" in "contacts" table
    - Set the "status" column at "processing" for the selected contact
    - Proceed to the next step with the selected contact
*/

/* 2 Send the email with Resend to contact using Resend API
    SPECIFICATIONS:
    - Use the email object, content, cta, footer from the personalized email content to send the email to the contact.
    - content, cta, and footer should be integrated in the email content as plain text.
    - Use Resend API to send the email to the contact.
    - Use the Resend API key from the .env file.
    - Update the stauts of the contact in "contacts" table to "processed" or "error" depending on the result of the email sending.
    - Update the status of the email in Supabase emails table to "sent" or "error" depending on the result of the email sending.
*/










// 8 Repeat the process for the next contact with "status" column at "new"