package vn.editor.payment;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Random;
import org.junit.jupiter.api.Test;
import vn.editor.payment.billing.domain.BillingFailure;
import vn.editor.payment.billing.domain.BillingPolicy;
import vn.editor.payment.billing.domain.BillingSaga;

class BillingSagaTest {
  @Test
  void reorderedDuplicateRepliesNeverActivateBeforeAllParticipants() {
    var random = new Random(20261009);
    for (int run = 0; run < 200; run++) {
      var participants =
          new ArrayList<>(List.of("identity", "document", "processing", "collaboration"));
      Collections.shuffle(participants, random);
      BillingSaga entity = new BillingSaga(7, "APPLY", "PROVISIONING", 0);
      int received = 0;
      for (String participant : participants) {
        var result = entity.acknowledge(7, "APPLY", participant, "APPLIED");
        received++;
        assertEquals(
            received == 4 ? BillingSaga.Decision.ACTIVATE : BillingSaga.Decision.WAIT,
            result.decision());
        entity = new BillingSaga(7, "APPLY", "PROVISIONING", result.replies());
        assertEquals(
            BillingSaga.Decision.IGNORE,
            entity.acknowledge(7, "APPLY", participant, "APPLIED").decision());
        assertEquals(
            BillingSaga.Decision.IGNORE,
            entity.acknowledge(6, "APPLY", participant, "APPLIED").decision());
      }
    }
  }

  @Test
  void compensationIsNotFinancialSuccessAndCannotBeReactivatedByAnOldReply() {
    var active = new BillingSaga(3, "APPLY", "PROVISIONING", 7);
    assertEquals(
        BillingSaga.Decision.COMPENSATE,
        active.acknowledge(3, "APPLY", "collaboration", "REJECTED").decision());
    var rollback = new BillingSaga(4, "COMPENSATE", "COMPENSATING", 7);
    assertEquals(
        BillingSaga.Decision.IGNORE,
        rollback.acknowledge(3, "APPLY", "collaboration", "APPLIED").decision());
    assertEquals(
        BillingSaga.Decision.REVIEW,
        rollback.acknowledge(4, "COMPENSATE", "collaboration", "APPLIED").decision());
  }

  @Test
  void expiredAndUnknownPlansFailClosed() {
    assertEquals("FREE", BillingPolicy.effective("PRO_MONTHLY", Instant.EPOCH, Instant.now()));
    assertThrows(BillingFailure.class, () -> BillingPolicy.checkout(null));
    assertThrows(BillingFailure.class, () -> BillingPolicy.checkout("price_client_supplied"));
    assertThrows(BillingFailure.class, () -> BillingPolicy.checkout("FREE"));
  }
}
