import frappe
from frappe.model.document import Document


# NOTE: class name must be doctype.replace(" ","").replace("-","") =
# "PettyCashTopupRequest" (lowercase 'up'). Frappe's get_controller derives
# it that way; a mismatch makes migrate flag the DocType as orphaned and
# delete it. Keep this exact spelling.
class PettyCashTopupRequest(Document):
    def before_insert(self):
        if not self.status:
            self.status = "Pending"
        if not self.currency:
            self.currency = "AED"
