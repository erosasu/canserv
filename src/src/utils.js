/**
 * Formats a phone number by removing the country code and suffix.
 * @param {string} contact - Contact number (e.g., 5213331184802@c.us)
 * @returns {string} Formatted contact number (e.g., 3331184802)
 */
export function formatContact(contact) {
  return contact.replace(/^521/, '').replace(/@c.us$/, '');
}

/**
 * Adds a tool message to the thread.
 * @param {Object} thread - Chat thread
 * @param {string} toolCallId - Tool call ID
 * @param {string} toolFunctionName - Name of the tool function
 * @param {string|Object} content - Tool execution result
 */
export function addToolMessage(thread, toolCallId, toolFunctionName, content) {
  thread.messages.push({
    role: 'tool',
    tool_call_id: toolCallId,
    name: toolFunctionName,
    content: typeof content === 'string' ? content : JSON.stringify(content),
  });
}

/**
 * Validates required tool arguments.
 * @param {Object} args - Tool arguments
 * @param {string[]} requiredKeys - Required argument keys
 * @throws {ValidationError} If required arguments are missing
 */
export function validateToolArguments(args, requiredKeys) {
  const missingKeys = requiredKeys.filter(
    (key) => !(key in args) || args[key] == null
  );
  if (missingKeys.length > 0) {
    console.log(`Missing required arguments: ${missingKeys.join(', ')}`);
  }
}
