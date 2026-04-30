import frappe
from frappe.model.document import Document


class PettyCashTopupRequest(Document):
    def before_insert(self):
        if not self.status:
            self.status = "Pending"
        if not self.currency:
            self.currency = "AED"
